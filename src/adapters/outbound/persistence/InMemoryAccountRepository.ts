import type { Account } from '../../../domain/entities/Account'
import type { AccountId } from '../../../domain/value-objects/AccountId'
import type { DisplayName } from '../../../domain/value-objects/DisplayName'
import type { EmailAddress } from '../../../domain/value-objects/EmailAddress'
import type {
  AccountRepositoryPort,
  HashedSecurityAnswer,
  PrivacyConsentRecord,
} from '../../../application/ports/AccountRepositoryPort'
import type { AccountSnapshot } from '../../../domain/entities/Account'
import { hydrateAccount } from './hydrate-account'

export class InMemoryAccountRepository implements AccountRepositoryPort {
  private readonly byId = new Map<string, AccountSnapshot>()
  private readonly answersByAccount = new Map<string, readonly HashedSecurityAnswer[]>()
  private readonly consentsByAccount = new Map<string, PrivacyConsentRecord[]>()

  save(account: Account): Promise<void> {
    this.byId.set(account.id.value, account.toSnapshot())

    return Promise.resolve()
  }

  saveRegistration(
    account: Account,
    answers: readonly HashedSecurityAnswer[],
    consent?: PrivacyConsentRecord,
  ): Promise<void> {
    this.byId.set(account.id.value, account.toSnapshot())
    this.answersByAccount.set(account.id.value, answers)

    // APPEND-ONLY, igual que el adaptador de PostgreSQL: se anade a la lista
    // existente, nunca se reemplaza. `?? []` crea la lista la primera vez sin
    // necesitar una comprobacion de existencia aparte.
    if (consent !== undefined) {
      const historial = this.consentsByAccount.get(account.id.value) ?? []
      historial.push(consent)
      this.consentsByAccount.set(account.id.value, historial)
    }

    return Promise.resolve()
  }

  findById(id: AccountId): Promise<Account | null> {
    const snapshot = this.byId.get(id.value)

    return Promise.resolve(snapshot === undefined ? null : hydrateAccount(snapshot))
  }

  findByEmail(email: EmailAddress): Promise<Account | null> {
    for (const snapshot of this.byId.values()) {
      if (snapshot.email === email.value) {
        return Promise.resolve(hydrateAccount(snapshot))
      }
    }

    return Promise.resolve(null)
  }

  findBySubject(subject: string): Promise<Account | null> {
    for (const snapshot of this.byId.values()) {
      if (snapshot.subject === subject) {
        return Promise.resolve(hydrateAccount(snapshot))
      }
    }

    return Promise.resolve(null)
  }

  findByDisplayName(displayName: DisplayName): Promise<Account | null> {
    const needle = displayName.value.toLowerCase()

    for (const snapshot of this.byId.values()) {
      if (snapshot.displayName.toLowerCase() === needle) {
        return Promise.resolve(hydrateAccount(snapshot))
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

  existsByDisplayName(displayName: DisplayName): Promise<boolean> {
    const needle = displayName.value.toLowerCase()

    for (const snapshot of this.byId.values()) {
      if (snapshot.displayName.toLowerCase() === needle) {
        return Promise.resolve(true)
      }
    }

    return Promise.resolve(false)
  }

  findSecurityAnswers(id: AccountId): Promise<readonly HashedSecurityAnswer[]> {
    return Promise.resolve(this.answersByAccount.get(id.value) ?? [])
  }

  findPrivacyConsents(id: AccountId): Promise<readonly PrivacyConsentRecord[]> {
    return Promise.resolve(this.consentsByAccount.get(id.value) ?? [])
  }

  answersOf(accountId: string): readonly HashedSecurityAnswer[] {
    return this.answersByAccount.get(accountId) ?? []
  }

  get size(): number {
    return this.byId.size
  }

  clear(): void {
    this.byId.clear()
    this.answersByAccount.clear()
    this.consentsByAccount.clear()
  }
}
