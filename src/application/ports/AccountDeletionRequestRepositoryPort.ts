import type { AccountDeletionRequest } from '../../domain/entities/AccountDeletionRequest'
import type { AccountId } from '../../domain/value-objects/AccountId'

/**
 * Puerto de persistencia de la solicitud durable de eliminacion (HU-43.1).
 *
 * Vive enteramente dentro de Account (ADR-014 Decision 5): no hay metodo
 * aqui para invocar, consultar ni orquestar ningun otro bounded context.
 */
export interface AccountDeletionRequestRepositoryPort {
  /**
   * Persiste una solicitud nueva o el avance de una ya existente (mismo `id`).
   *
   * Debe rechazar, mediante `AccountHasActiveDeletionRequestError`, el intento
   * de persistir una solicitud NUEVA (id distinto) para una cuenta que ya
   * tiene una activa — incluso bajo llamadas concurrentes. Es la proteccion
   * exigida por HU-43.1 contra procesos destructivos paralelos.
   */
  save(request: AccountDeletionRequest): Promise<void>

  findById(id: string): Promise<AccountDeletionRequest | null>

  /**
   * La solicitud activa (no `Closed`) de una cuenta, si existe. Es lo que
   * permite recuperar/reanudar un proceso en curso y tratar de forma
   * idempotente una solicitud repetida.
   */
  findActiveByAccountId(accountId: AccountId): Promise<AccountDeletionRequest | null>
}

export const ACCOUNT_DELETION_REQUEST_REPOSITORY = Symbol('AccountDeletionRequestRepositoryPort')
