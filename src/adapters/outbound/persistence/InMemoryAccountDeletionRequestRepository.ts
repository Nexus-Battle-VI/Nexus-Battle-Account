import {
  AccountDeletionRequest,
  type AccountDeletionRequestSnapshot,
} from '../../../domain/entities/AccountDeletionRequest'
import type { AccountId } from '../../../domain/value-objects/AccountId'
import type { AccountDeletionRequestRepositoryPort } from '../../../application/ports/AccountDeletionRequestRepositoryPort'
import { AccountHasActiveDeletionRequestError } from '../../../application/errors/ApplicationError'

/**
 * Doble en memoria del repositorio de solicitudes de eliminacion (HU-43.1).
 *
 * Reproduce la MISMA regla que el indice unico parcial de PostgreSQL: una
 * solicitud nueva (`id` que todavia no existe) para una cuenta que ya tiene
 * una activa se rechaza con `AccountHasActiveDeletionRequestError`, no solo
 * en el adaptador real. Sin esto, una prueba podria pasar contra un doble
 * mas permisivo que el contrato que produccion exige.
 */
export class InMemoryAccountDeletionRequestRepository implements AccountDeletionRequestRepositoryPort {
  private readonly byId = new Map<string, AccountDeletionRequestSnapshot>()

  save(request: AccountDeletionRequest): Promise<void> {
    const snapshot = request.toSnapshot()
    const isNew = !this.byId.has(snapshot.id)

    if (isNew && snapshot.status !== 'CLOSED') {
      const yaActiva = [...this.byId.values()].some(
        (existing) => existing.accountId === snapshot.accountId && existing.status !== 'CLOSED',
      )

      if (yaActiva) {
        return Promise.reject(new AccountHasActiveDeletionRequestError())
      }
    }

    this.byId.set(snapshot.id, snapshot)

    return Promise.resolve()
  }

  findById(id: string): Promise<AccountDeletionRequest | null> {
    const snapshot = this.byId.get(id)

    return Promise.resolve(snapshot === undefined ? null : AccountDeletionRequest.restore(snapshot))
  }

  findActiveByAccountId(accountId: AccountId): Promise<AccountDeletionRequest | null> {
    const found = [...this.byId.values()].find(
      (snapshot) => snapshot.accountId === accountId.value && snapshot.status !== 'CLOSED',
    )

    return Promise.resolve(found === undefined ? null : AccountDeletionRequest.restore(found))
  }

  findPendingForProcessing(limit: number): Promise<readonly AccountDeletionRequest[]> {
    const pending = [...this.byId.values()]
      .filter((snapshot) => snapshot.status !== 'CLOSED')
      .sort((left, right) => left.receivedAt.localeCompare(right.receivedAt))
      .slice(0, limit)
      .map((snapshot) => AccountDeletionRequest.restore(snapshot))

    return Promise.resolve(pending)
  }
}
