import type { Kysely } from 'kysely'

import {
  AccountDeletionRequest,
  type AccountDeletionRequestStatus,
} from '../../../domain/entities/AccountDeletionRequest'
import type { AccountId } from '../../../domain/value-objects/AccountId'
import type { AccountDeletionRequestRepositoryPort } from '../../../application/ports/AccountDeletionRequestRepositoryPort'
import { AccountHasActiveDeletionRequestError } from '../../../application/errors/ApplicationError'
import type { Database } from './schema'

/** Codigo SQLSTATE de PostgreSQL para violacion de restriccion unica. */
const UNIQUE_VIOLATION = '23505'

/** Nombre declarado en la migracion `hu43-account-deletion-requests`. */
const ONE_ACTIVE_PER_ACCOUNT_INDEX = 'account_deletion_requests_una_activa_por_cuenta'

interface PossiblePgError {
  readonly code?: unknown
  readonly constraint?: unknown
}

/**
 * Distingue la violacion del indice unico parcial de cualquier otro error de
 * PostgreSQL. Comprobar tambien el nombre de la restriccion -no solo el
 * codigo `23505`- evita traducir como "solicitud activa duplicada" un choque
 * de unicidad que en el futuro pudiera venir de otra restriccion de esta
 * misma tabla.
 */
const isActiveRequestConflict = (error: unknown): boolean => {
  const candidate = error as PossiblePgError

  return (
    candidate.code === UNIQUE_VIOLATION && candidate.constraint === ONE_ACTIVE_PER_ACCOUNT_INDEX
  )
}

/**
 * Solicitud durable de eliminacion de cuenta en PostgreSQL (HU-43.1).
 *
 * `save` inserta o actualiza por `id` (misma solicitud avanzando de estado).
 * La proteccion contra dos solicitudes ACTIVAS para la misma cuenta no la
 * aplica esta clase con una consulta previa -eso deja abierta la carrera
 * evidente entre dos peticiones concurrentes-, la aplica el indice unico
 * parcial de la migracion: esta clase solo traduce su violacion a un error
 * de aplicacion explicito.
 */
export class PostgresAccountDeletionRequestRepository implements AccountDeletionRequestRepositoryPort {
  private readonly db: Kysely<Database>

  constructor(db: Kysely<Database>) {
    this.db = db
  }

  async save(request: AccountDeletionRequest): Promise<void> {
    const snapshot = request.toSnapshot()

    try {
      await this.db
        .insertInto('account_deletion_requests')
        .values({
          id: snapshot.id,
          account_id: snapshot.accountId,
          status: snapshot.status,
          received_at: new Date(snapshot.receivedAt),
          closed_at: snapshot.closedAt === null ? null : new Date(snapshot.closedAt),
        })
        .onConflict((oc) =>
          oc.column('id').doUpdateSet({
            status: snapshot.status,
            closed_at: snapshot.closedAt === null ? null : new Date(snapshot.closedAt),
          }),
        )
        .execute()
    } catch (error: unknown) {
      if (isActiveRequestConflict(error)) {
        throw new AccountHasActiveDeletionRequestError()
      }

      throw error
    }
  }

  async findById(id: string): Promise<AccountDeletionRequest | null> {
    const row = await this.db
      .selectFrom('account_deletion_requests')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()

    return row === undefined ? null : this.hydrate(row)
  }

  async findActiveByAccountId(accountId: AccountId): Promise<AccountDeletionRequest | null> {
    const row = await this.db
      .selectFrom('account_deletion_requests')
      .selectAll()
      .where('account_id', '=', accountId.value)
      .where('status', '<>', 'CLOSED')
      .executeTakeFirst()

    return row === undefined ? null : this.hydrate(row)
  }

  private hydrate(row: {
    id: string
    account_id: string
    status: string
    received_at: Date
    closed_at: Date | null
  }): AccountDeletionRequest {
    return AccountDeletionRequest.restore({
      id: row.id,
      accountId: row.account_id,
      status: row.status as AccountDeletionRequestStatus,
      receivedAt: row.received_at.toISOString(),
      closedAt: row.closed_at === null ? null : row.closed_at.toISOString(),
    })
  }
}
