import { AccountDeletionRequestStatus } from '../../domain/entities/AccountDeletionRequest'
import type { AccountDeletionRequest } from '../../domain/entities/AccountDeletionRequest'
import { AccountId } from '../../domain/value-objects/AccountId'
import type { AccountRepositoryPort } from '../ports/AccountRepositoryPort'
import type { AccountDeletionRequestRepositoryPort } from '../ports/AccountDeletionRequestRepositoryPort'
import type { AvatarStoragePort } from '../ports/AvatarStoragePort'
import type { NotificationRequestPort } from '../ports/NotificationRequestPort'
import type { ClockPort } from '../ports/ClockPort'

/**
 * La aplicacion solo depende de sus puertos y del dominio: nunca de
 * `infrastructure/observability`. Mismo patron que `RecoveryLog` en
 * `VerifyRecoveryAnswers`.
 */
export interface ProcessAccountDeletionLog {
  info(message: string, context?: Readonly<Record<string, string | number | boolean | null>>): void
  warn(message: string, context?: Readonly<Record<string, string | number | boolean | null>>): void
  error(message: string, context?: Readonly<Record<string, string | number | boolean | null>>): void
}

const describeFailure = (error: unknown): string =>
  error instanceof Error ? error.message : 'fallo desconocido'

export const ProcessAccountDeletionOutcome = {
  Closed: 'CLOSED',
  AlreadyClosed: 'ALREADY_CLOSED',
  Failed: 'FAILED',
} as const

export type ProcessAccountDeletionOutcome =
  (typeof ProcessAccountDeletionOutcome)[keyof typeof ProcessAccountDeletionOutcome]

export interface ProcessAccountDeletionResult {
  readonly outcome: ProcessAccountDeletionOutcome
  readonly requestId: string
}

export interface ProcessAccountDeletionDependencies {
  readonly accounts: AccountRepositoryPort
  readonly deletionRequests: AccountDeletionRequestRepositoryPort
  readonly avatars: AvatarStoragePort
  readonly notifications: NotificationRequestPort
  readonly clock: ClockPort
  readonly logger: ProcessAccountDeletionLog
}

/**
 * Tratamiento durable de datos personales y cierre de HU-43 (HU-43.3,
 * Management Task #305).
 *
 * Opera sobre una solicitud ya reclamada por
 * `AccountDeletionRequestRepositoryPort.claimNextPending` (en `IN_PROGRESS`).
 * No decide POR SU CUENTA que categorias tratar: aplica exactamente lo que
 * la matriz de tratamiento de datos vigente (`data-treatment-matrix-v0.3.md`)
 * ya aprueba para las categorias propiedad de Account -nombres, apellidos,
 * apodo, correo, avatar, respuestas de seguridad, roles, estado y marcas
 * temporales-, eliminando fisicamente la fila de `accounts`
 * (`AccountRepositoryPort.deleteById`; los roles y las respuestas de
 * seguridad caen en cascada por restriccion de base de datos).
 *
 * `terms_accepted` queda fuera de una decision propia: la matriz lo marca
 * "Pendiente decision" (ligado a `consent-versioning.md` y a ADR-014
 * Decision 1, todavia `Proposed`). No existe hoy ningun mecanismo de
 * evidencia de consentimiento donde conservar una copia antes de eliminar, asi
 * que este tratamiento NO inventa uno: `terms_accepted` desaparece como
 * consecuencia de la eliminacion fisica de la fila, igual que `status` o las
 * marcas temporales, no por una decision separada sobre ese campo
 * especificamente. Ver el PR para el detalle completo de este pendiente.
 *
 * Cognito NO se toca: la matriz declara la credencial/identidad "fuera del
 * alcance de HU-43 sobre datos propios" al no existir una decision formal que
 * ordene eliminarla.
 */
export class ProcessAccountDeletion {
  private readonly deps: ProcessAccountDeletionDependencies

  constructor(deps: ProcessAccountDeletionDependencies) {
    this.deps = deps
  }

  async execute(request: AccountDeletionRequest): Promise<ProcessAccountDeletionResult> {
    if (request.currentStatus === AccountDeletionRequestStatus.Closed) {
      return { outcome: ProcessAccountDeletionOutcome.AlreadyClosed, requestId: request.id }
    }

    const now = this.deps.clock.now()

    // Verificacion del plazo (HU-43.3): HU-43 no define ninguna accion de
    // negocio para una solicitud que lo supera, asi que esto es solo una
    // senal de observabilidad, nunca una condicion que bloquee o desvie el
    // tratamiento.
    if (!request.isWithinPolicyDeadline(now)) {
      this.deps.logger.warn('account_deletion_overdue', {
        requestId: request.id,
        receivedAt: request.receivedAt.toISOString(),
      })
    }

    let recipient: string | null = null

    try {
      const accountId = AccountId.create(request.accountId)
      const account = await this.deps.accounts.findById(accountId)

      // `account === null` significa que un intento anterior ya elimino la
      // cuenta y se interrumpio antes de cerrar la solicitud: el tratamiento
      // de datos ya esta completo, y repetirlo aqui no tiene nada que hacer
      // -exactamente el caso que exige idempotencia ante reintento.
      if (account !== null) {
        recipient = account.currentEmail.value

        // El avatar se retira ANTES de borrar la fila: si esto fallara y la
        // cuenta siguiera existiendo, un reintento puede recuperar de nuevo
        // `storageKey` desde `account`. Retirarlo despues arriesgaria perder
        // esa clave si el reintento ya no encuentra la fila.
        await this.deps.avatars.remove(account.currentAvatar.storageKey)
        await this.deps.accounts.deleteById(accountId)
      }
    } catch (error: unknown) {
      request.markFailed()
      await this.deps.deletionRequests.save(request)

      this.deps.logger.error('account_deletion_failed', {
        requestId: request.id,
        reason: describeFailure(error),
      })

      return { outcome: ProcessAccountDeletionOutcome.Failed, requestId: request.id }
    }

    request.close(now)

    try {
      await this.deps.deletionRequests.save(request)
    } catch (error: unknown) {
      // El tratamiento de datos YA se completo (o ya estaba completo desde un
      // intento anterior): esto es un fallo de persistir el CIERRE, no del
      // tratamiento. No se puede volver a marcar `markFailed` de forma segura
      // -el objeto en memoria ya transiciono a `Closed`, y reintentar el
      // borrado de una cuenta que ya no existe no es el problema real-. Se
      // registra y se propaga: el intento siguiente de `claimNextPending`
      // reclamara la misma solicitud (sigue `IN_PROGRESS` en la base, porque
      // esta escritura fallo) y, al no encontrar ya la cuenta, cerrara sin
      // repetir el tratamiento.
      this.deps.logger.error('account_deletion_close_persist_failed', {
        requestId: request.id,
        reason: describeFailure(error),
      })

      throw error
    }

    this.deps.logger.info('account_deletion_closed', { requestId: request.id })

    await this.requestClosureNotification(request.id, recipient)

    return { outcome: ProcessAccountDeletionOutcome.Closed, requestId: request.id }
  }

  /**
   * Se solicita UNICAMENTE despues de que el cierre ya quedo persistido.
   * `NotificationRequestPort` es best-effort por contrato (los dos
   * adaptadores existentes -HTTP y logging- nunca rechazan esta llamada):
   * un fallo de entrega de Notifications no deshace ni reabre el tratamiento
   * de datos, que ya es irreversible en este punto.
   *
   * `templateId` es el mismo que registro HU-43.4 (Management #306,
   * `account-deletion-closed`) en el catalogo de plantillas de Notifications:
   * no declara variables, asi que no hay ninguna que enviar.
   *
   * Limitacion conocida y documentada en el PR: si el proceso se interrumpe
   * DESPUES de eliminar la cuenta pero ANTES de completar esta llamada, un
   * reintento posterior ya no tiene `recipient` que capturar -la cuenta ya no
   * existe- y esta notificacion de cierre se pierde. Ninguna otra operacion
   * de este servicio persiste un correo fuera de la propia cuenta para
   * evitar justamente esto, y anadir un mecanismo nuevo solo para esta
   * ventana seria una transaccion distribuida que la arquitectura actual no
   * tiene en ningun otro punto.
   */
  private async requestClosureNotification(
    requestId: string,
    recipient: string | null,
  ): Promise<void> {
    if (recipient === null) {
      this.deps.logger.warn('account_deletion_notification_skipped', { requestId })

      return
    }

    try {
      await this.deps.notifications.request({
        notificationId: requestId,
        recipient,
        templateId: 'account-deletion-closed',
        variables: {},
      })
    } catch (error: unknown) {
      // Los dos adaptadores reales (HTTP y logging) no rechazan nunca esta
      // llamada; esta guarda existe para que NINGUNA implementacion futura de
      // `NotificationRequestPort` pueda, por accidente, hacer que un fallo de
      // entrega revierta un tratamiento de datos que ya es irreversible.
      this.deps.logger.error('account_deletion_notification_failed', {
        requestId,
        reason: describeFailure(error),
      })
    }
  }
}
