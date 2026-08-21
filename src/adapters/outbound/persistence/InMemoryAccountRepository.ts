import type { Account } from '../../../domain/entities/Account'
import { Account as AccountAggregate } from '../../../domain/entities/Account'
import { AccountId } from '../../../domain/value-objects/AccountId'
import { DisplayName } from '../../../domain/value-objects/DisplayName'
import { EmailAddress } from '../../../domain/value-objects/EmailAddress'
import type { AccountRepositoryPort } from '../../../application/ports/AccountRepositoryPort'
import type { AccountSnapshot } from '../../../domain/entities/Account'

/**
 * Repositorio en memoria del agregado Account.
 *
 * Almacena instantaneas, no referencias al agregado, de modo que una mutacion
 * no persistida nunca se filtra al almacen. Ese detalle importa: con
 * referencias vivas, una prueba pasaria aunque el caso de uso olvidara guardar.
 *
 * El adaptador definitivo sobre PostgreSQL queda sujeto a ADR-005.
 */
export class InMemoryAccountRepository implements AccountRepositoryPort {
  private readonly byId = new Map<string, AccountSnapshot>()

  save(account: Account): Promise<void> {
    this.byId.set(account.id.value, account.toSnapshot())

    return Promise.resolve()
  }

  findById(id: AccountId): Promise<Account | null> {
    const snapshot = this.byId.get(id.value)

    return Promise.resolve(
      snapshot === undefined ? null : InMemoryAccountRepository.hydrate(snapshot),
    )
  }

  findByEmail(email: EmailAddress): Promise<Account | null> {
    for (const snapshot of this.byId.values()) {
      if (snapshot.email === email.value) {
        return Promise.resolve(InMemoryAccountRepository.hydrate(snapshot))
      }
    }

    return Promise.resolve(null)
  }

  existsByEmail(email: EmailAddress): Promise<boolean> {
    for (const snapshot of this.byId.values()) {
      if (snapshot.email === email.value) {
        return Promise.resolve(true)
      }
    }

    return Promise.resolve(false)
  }

  get size(): number {
    return this.byId.size
  }

  clear(): void {
    this.byId.clear()
  }

  private static hydrate(snapshot: AccountSnapshot): Account {
    return AccountAggregate.restore({
      id: AccountId.create(snapshot.id),
      email: EmailAddress.create(snapshot.email),
      displayName: DisplayName.create(snapshot.displayName),
      status: snapshot.status,
      roles: snapshot.roles,
    })
  }
}
