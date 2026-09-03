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

  /**
   * Reclama, de forma atomica, la solicitud pendiente mas antigua para
   * procesarla (HU-43.3): `RECEIVED`/`FAILED` avanzan a `IN_PROGRESS` como
   * parte de la misma operacion; una que ya estaba `IN_PROGRESS` -un intento
   * previo que se interrumpio antes de cerrar- se devuelve tal cual, para que
   * el procesamiento pueda reanudarse.
   *
   * Es la proteccion real contra dos procesadores tomando la MISMA solicitud
   * a la vez (HU-43.3): el adaptador de PostgreSQL la implementa con
   * `SELECT ... FOR UPDATE SKIP LOCKED`, no con una comprobacion previa en la
   * aplicacion que una carrera podria saltarse.
   *
   * Devuelve `null` cuando no hay ninguna solicitud pendiente que reclamar.
   */
  claimNextPending(): Promise<AccountDeletionRequest | null>
}

export const ACCOUNT_DELETION_REQUEST_REPOSITORY = Symbol('AccountDeletionRequestRepositoryPort')
