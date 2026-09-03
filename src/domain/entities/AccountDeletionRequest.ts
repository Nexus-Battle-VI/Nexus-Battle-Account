import { DomainError } from '../errors/DomainError'
import type { AccountId } from '../value-objects/AccountId'

export const AccountDeletionRequestStatus = {
  Received: 'RECEIVED',
  InProgress: 'IN_PROGRESS',
  Failed: 'FAILED',
  Closed: 'CLOSED',
} as const

export type AccountDeletionRequestStatus =
  (typeof AccountDeletionRequestStatus)[keyof typeof AccountDeletionRequestStatus]

export interface AccountDeletionRequestSnapshot {
  readonly id: string
  readonly accountId: string
  readonly status: AccountDeletionRequestStatus
  readonly receivedAt: string
  readonly closedAt: string | null
}

/**
 * Solicitud durable de eliminacion de cuenta (HU-43.1).
 *
 * NO ejecuta el derecho al olvido: solo representa, dentro de Account, que un
 * titular pidio eliminar su cuenta, y en que punto va ese tratamiento. El
 * alcance de HU-43 ya esta fijado en EN-011 (Management #197) y en ADR-014
 * Decision 5 — Account trata sus propios datos personales, sin coordinar
 * Community, Commerce, Player/Inventory ni Catalog. Esta entidad no modela
 * ningun progreso "por bounded context" porque esa orquestacion no existe.
 *
 * Guarda unicamente la referencia al agregado (`accountId`), nunca una copia
 * de correo, apodo, avatar ni datos de perfil: esos siguen viviendo en
 * `Account`, y duplicarlos aqui violaria la minimizacion de datos que la
 * propia HU-43 exige aplicar.
 *
 * `Closed` es el unico estado terminal. `Received`, `InProgress` y `Failed`
 * se consideran "activos" a efectos de impedir una segunda solicitud
 * incompatible para la misma cuenta (ver
 * `AccountDeletionRequestRepositoryPort` y la migracion): un fallo transitorio
 * no libera la proteccion, porque la solicitud original sigue pendiente de
 * reintento dentro del plazo de 30 dias (Politica S10), no de una nueva
 * solicitud independiente.
 */
export class AccountDeletionRequest {
  readonly id: string
  readonly accountId: string
  private status: AccountDeletionRequestStatus
  readonly receivedAt: Date
  private closedAt: Date | null

  private constructor(snapshot: AccountDeletionRequestSnapshot) {
    this.id = snapshot.id
    this.accountId = snapshot.accountId
    this.status = snapshot.status
    this.receivedAt = new Date(snapshot.receivedAt)
    this.closedAt = snapshot.closedAt === null ? null : new Date(snapshot.closedAt)
  }

  /**
   * Registra la recepcion de una nueva solicitud.
   *
   * `id` lo genera el backend (`IdGeneratorPort`), nunca el cliente.
   * `receivedAt` lo genera el backend a partir de `ClockPort`, por la misma
   * razon que el resto de fechas de evidencia de este servicio: nunca un
   * valor enviado por Web.
   */
  static receive(input: {
    id: string
    accountId: AccountId
    occurredAt: Date
  }): AccountDeletionRequest {
    if (input.id.trim().length === 0) {
      throw new DomainError('La solicitud de eliminacion exige un identificador.')
    }

    return new AccountDeletionRequest({
      id: input.id,
      accountId: input.accountId.value,
      status: AccountDeletionRequestStatus.Received,
      receivedAt: input.occurredAt.toISOString(),
      closedAt: null,
    })
  }

  static restore(snapshot: AccountDeletionRequestSnapshot): AccountDeletionRequest {
    return new AccountDeletionRequest(snapshot)
  }

  get currentStatus(): AccountDeletionRequestStatus {
    return this.status
  }

  get currentClosedAt(): Date | null {
    return this.closedAt
  }

  /** `Closed` es el unico estado que no cuenta como solicitud activa. */
  get isActive(): boolean {
    return this.status !== AccountDeletionRequestStatus.Closed
  }

  /** El tratamiento dentro de Account empieza a ejecutarse (Decision 5, ADR-014). */
  beginTreatment(): void {
    if (this.status !== AccountDeletionRequestStatus.Received) {
      throw new DomainError('La solicitud solo puede iniciar tratamiento desde RECEIVED.')
    }

    this.status = AccountDeletionRequestStatus.InProgress
  }

  /**
   * Un fallo transitorio del tratamiento. No cierra la solicitud: sigue
   * activa y elegible para reintento dentro del plazo de 30 dias.
   */
  markFailed(): void {
    if (this.status !== AccountDeletionRequestStatus.InProgress) {
      throw new DomainError('Solo una solicitud en tratamiento puede marcarse como fallida.')
    }

    this.status = AccountDeletionRequestStatus.Failed
  }

  /** Reintento tras un fallo transitorio. */
  retry(): void {
    if (this.status !== AccountDeletionRequestStatus.Failed) {
      throw new DomainError('Solo una solicitud fallida admite reintento.')
    }

    this.status = AccountDeletionRequestStatus.InProgress
  }

  /**
   * Cierre de la solicitud (Politica S10: confirmacion de cierre). `closedAt`
   * lo genera el backend, igual que `receivedAt`.
   */
  close(occurredAt: Date): void {
    if (this.status !== AccountDeletionRequestStatus.InProgress) {
      throw new DomainError('Solo una solicitud en tratamiento puede cerrarse.')
    }

    this.status = AccountDeletionRequestStatus.Closed
    this.closedAt = occurredAt
  }

  toSnapshot(): AccountDeletionRequestSnapshot {
    return {
      id: this.id,
      accountId: this.accountId,
      status: this.status,
      receivedAt: this.receivedAt.toISOString(),
      closedAt: this.closedAt === null ? null : this.closedAt.toISOString(),
    }
  }
}
