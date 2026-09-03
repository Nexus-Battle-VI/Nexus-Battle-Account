import {
  AccountDeletionRequest,
  AccountDeletionRequestStatus,
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

  /**
   * Sin concurrencia real que proteger -JavaScript es de un solo hilo-, esta
   * version solo reproduce la SEMANTICA: toma la mas antigua no cerrada y
   * aplica la misma transicion de dominio que el adaptador de PostgreSQL. La
   * proteccion real contra dos procesadores a la vez se verifica contra
   * PostgreSQL de verdad (`FOR UPDATE SKIP LOCKED`), no aqui.
   */
  claimNextPending(): Promise<AccountDeletionRequest | null> {
    const oldest = [...this.byId.values()]
      .filter((snapshot) => snapshot.status !== AccountDeletionRequestStatus.Closed)
      .sort(
        (left, right) => new Date(left.receivedAt).getTime() - new Date(right.receivedAt).getTime(),
      )[0]

    if (oldest === undefined) {
      return Promise.resolve(null)
    }

    const request = AccountDeletionRequest.restore(oldest)

    if (request.currentStatus === AccountDeletionRequestStatus.Received) {
      request.beginTreatment()
    } else if (request.currentStatus === AccountDeletionRequestStatus.Failed) {
      request.retry()
    }

    this.byId.set(request.id, request.toSnapshot())

    return Promise.resolve(request)
  }
}
