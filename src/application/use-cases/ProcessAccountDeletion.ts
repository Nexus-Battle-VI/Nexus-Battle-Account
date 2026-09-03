import {
  AccountDeletionRequestStatus,
  type AccountDeletionRequest,
} from '../../domain/entities/AccountDeletionRequest'
import { AccountId } from '../../domain/value-objects/AccountId'
import type { AccountRepositoryPort } from '../ports/AccountRepositoryPort'
import type { AccountDeletionRequestRepositoryPort } from '../ports/AccountDeletionRequestRepositoryPort'
import type { AvatarStoragePort } from '../ports/AvatarStoragePort'
import type { NotificationRequestPort } from '../ports/NotificationRequestPort'
import type { ClockPort } from '../ports/ClockPort'

export interface ProcessAccountDeletionLog {
  info(message: string, context?: Readonly<Record<string, string | number | boolean>>): void
  warn(message: string, context?: Readonly<Record<string, string | number | boolean>>): void
  error(message: string, context?: Readonly<Record<string, string | number | boolean>>): void
}

export interface ProcessAccountDeletionSummary {
  readonly processed: number
  readonly closed: number
  readonly failed: number
}

const DEFAULT_BATCH_LIMIT = 20

/**
 * Identificador de la plantilla de cierre en Notifications (HU-43.4, Task
 * Management #306, repositorio Nexus-Battle-Notifications). Esta Task NO
 * define esa plantilla -vive en otro servicio-, solo el contrato del lado de
 * Account: el mismo identificador debe existir en el catalogo de plantillas
 * de Notifications antes de que la notificacion pueda entregarse. Hasta
 * entonces, `NotificationRequestPort` ya registra/entrega segun
 * `NOTIFICATIONS_INGEST_URL` este configurado o no (vease `HttpNotificationRequester`
 * y `LoggingNotificationRequester`); un rechazo del ingest no bloquea el
 * cierre de la solicitud, igual que en `VerifyRecoveryAnswers`.
 */
export const ACCOUNT_DELETION_CLOSED_TEMPLATE_ID = 'account-deletion-closed'

/**
 * Ejecuta el tratamiento durable de las solicitudes de eliminacion pendientes
 * y las cierra (HU-43.3, Task Management #305).
 *
 * NO es un endpoint HTTP: HU-43.2 ya registra la solicitud sin ejecutar el
 * tratamiento dentro de la misma peticion (la separacion es deliberada, ver
 * `RequestAccountDeletion`). Este caso de uso es el que Task #305 deja como
 * "procesador" -se invoca desde `npm run process-account-deletions`
 * (`src/infrastructure/jobs/process-account-deletions.ts`), el mismo patron
 * que `npm run migrate`: un paso explicito, no algo que ocurra al arrancar el
 * servicio ni dentro de una peticion HTTP.
 *
 * Cada solicitud se trata de forma independiente: el fallo de una no impide
 * procesar el resto del lote, y su reintento queda para la siguiente
 * ejecucion (el estado `FAILED` la mantiene elegible, ver
 * `AccountDeletionRequestRepositoryPort.findPendingForProcessing`).
 */
export class ProcessAccountDeletion {
  constructor(
    private readonly deps: {
      readonly accounts: AccountRepositoryPort
      readonly requests: AccountDeletionRequestRepositoryPort
      readonly avatars: AvatarStoragePort
      readonly notifications: NotificationRequestPort
      readonly clock: ClockPort
      readonly logger: ProcessAccountDeletionLog
      readonly batchLimit?: number
    },
  ) {}

  async execute(): Promise<ProcessAccountDeletionSummary> {
    const pending = await this.deps.requests.findPendingForProcessing(
      this.deps.batchLimit ?? DEFAULT_BATCH_LIMIT,
    )

    let closed = 0
    let failed = 0

    for (const request of pending) {
      try {
        await this.treat(request)
        closed += 1

        this.deps.logger.info('account_deletion_closed', { requestId: request.id })
      } catch (error: unknown) {
        failed += 1

        this.deps.logger.error('account_deletion_treatment_failed', {
          requestId: request.id,
          reason: error instanceof Error ? error.message : 'Fallo desconocido',
        })

        await this.markFailedIfInProgress(request)
      }
    }

    return { processed: pending.length, closed, failed }
  }

  /**
   * El orden importa para la reanudacion: el avatar se retira ANTES de
   * anonimizar y guardar la cuenta. Si se hiciera al reves y el borrado del
   * avatar fallara despues de guardar la cuenta ya anonimizada, un reintento
   * leeria `account.currentAvatar.storageKey` ya sobrescrito por el
   * marcador de `erase()` -no el original- y el archivo real nunca se
   * llegaria a borrar. Con este orden, mientras el borrado del avatar no
   * haya tenido exito, la cuenta sigue sin guardarse y el reintento vuelve a
   * calcular la MISMA clave real.
   */
  private async treat(request: AccountDeletionRequest): Promise<void> {
    if (request.currentStatus === AccountDeletionRequestStatus.Received) {
      request.beginTreatment()
      await this.deps.requests.save(request)
    } else if (request.currentStatus === AccountDeletionRequestStatus.Failed) {
      request.retry()
      await this.deps.requests.save(request)
    }

    const accountId = AccountId.create(request.accountId)
    const account = await this.deps.accounts.findById(accountId)

    if (account === null) {
      throw new Error(
        `La solicitud ${request.id} referencia la cuenta ${request.accountId}, que ya no existe.`,
      )
    }

    if (!account.isDeleted) {
      await this.deps.avatars.remove(account.currentAvatar.storageKey)
      account.erase()
      await this.deps.accounts.save(account)
    }

    await this.deps.accounts.deleteSecurityAnswers(accountId)

    await this.deps.notifications.request({
      // Estable a traves de reintentos: el mismo `request.id` en todo su
      // ciclo de vida. Es lo que permite que el pipeline de Notifications
      // deduplique por `notificationId` si esta notificacion ya se acepto en
      // un intento anterior que fallo despues, antes de cerrar la solicitud.
      notificationId: `${request.id}-cierre`,
      recipient: request.notificationRecipient,
      templateId: ACCOUNT_DELETION_CLOSED_TEMPLATE_ID,
      variables: { requestId: request.id },
    })

    request.close(this.deps.clock.now())
    await this.deps.requests.save(request)
  }

  private async markFailedIfInProgress(request: AccountDeletionRequest): Promise<void> {
    if (request.currentStatus !== AccountDeletionRequestStatus.InProgress) {
      return
    }

    request.markFailed()
    await this.deps.requests.save(request)
  }
}
