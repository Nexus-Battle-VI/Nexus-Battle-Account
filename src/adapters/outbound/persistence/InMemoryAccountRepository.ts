import type { Account } from '../../../domain/entities/Account'
import type { AccountId } from '../../../domain/value-objects/AccountId'
import type { DisplayName } from '../../../domain/value-objects/DisplayName'
import type { EmailAddress } from '../../../domain/value-objects/EmailAddress'
import type {
  AccountRepositoryPort,
  HashedSecurityAnswer,
} from '../../../application/ports/AccountRepositoryPort'
import type { AdminAccountQueryPort } from '../../../application/ports/AdminAccountQueryPort'
import type { AdminAccountQueryCriteria } from '../../../application/dto/AdminAccountQueryCriteria'
import {
  orderAdminAccountRoles,
  type AdminAccountSummaryDto,
} from '../../../application/dto/AdminAccountSummaryDto'
import type { AccountSnapshot } from '../../../domain/entities/Account'
import { hydrateAccount } from './hydrate-account'

interface AccountMetadata {
  readonly createdAt: Date
  readonly updatedAt: Date
}

export class InMemoryAccountRepository implements AccountRepositoryPort, AdminAccountQueryPort {
  private readonly byId = new Map<string, AccountSnapshot>()
  private readonly answersByAccount = new Map<string, readonly HashedSecurityAnswer[]>()
  private readonly metadataByAccount = new Map<string, AccountMetadata>()

  constructor(private readonly now: () => Date = () => new Date()) {}

  save(account: Account): Promise<void> {
    this.store(account)

    return Promise.resolve()
  }

  saveRegistration(account: Account, answers: readonly HashedSecurityAnswer[]): Promise<void> {
    this.store(account)
    this.answersByAccount.set(account.id.value, answers)

    return Promise.resolve()
  }

  query(criteria: AdminAccountQueryCriteria): Promise<readonly AdminAccountSummaryDto[]> {
    const items = [...this.byId.values()]
      .filter((snapshot) => matches(snapshot, criteria))
      .map((snapshot) => this.toAdminSummary(snapshot))
      .sort((left, right) => left.id.localeCompare(right.id))

    return Promise.resolve(items)
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

  deleteSecurityAnswers(id: AccountId): Promise<void> {
    this.answersByAccount.delete(id.value)

    return Promise.resolve()
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
    this.metadataByAccount.clear()
  }

  private store(account: Account): void {
    const snapshot = account.toSnapshot()
    const current = new Date(this.now().getTime())
    const metadata = this.metadataByAccount.get(snapshot.id)

    this.byId.set(snapshot.id, snapshot)
    this.metadataByAccount.set(snapshot.id, {
      createdAt: metadata?.createdAt ?? current,
      updatedAt: current,
    })
  }

  private toAdminSummary(snapshot: AccountSnapshot): AdminAccountSummaryDto {
    const metadata = this.metadataByAccount.get(snapshot.id)

    return {
      id: snapshot.id,
      email: snapshot.email,
      displayName: snapshot.displayName,
      firstNames: snapshot.firstNames,
      lastNames: snapshot.lastNames,
      status: snapshot.status,
      roles: orderAdminAccountRoles(snapshot.roles),
      registeredAt: (metadata?.createdAt ?? this.now()).toISOString(),
    }
  }
}

const matches = (snapshot: AccountSnapshot, criteria: AdminAccountQueryCriteria): boolean => {
  if (criteria.id !== undefined && snapshot.id !== criteria.id) {
    return false
  }

  if (criteria.email !== undefined && snapshot.email !== criteria.email) {
    return false
  }

  if (
    criteria.firstNames !== undefined &&
    !sameHumanText(snapshot.firstNames, criteria.firstNames)
  ) {
    return false
  }

  if (criteria.lastNames !== undefined && !sameHumanText(snapshot.lastNames, criteria.lastNames)) {
    return false
  }

  if (
    criteria.displayName !== undefined &&
    !sameHumanText(snapshot.displayName, criteria.displayName)
  ) {
    return false
  }

  if (criteria.role !== undefined && !snapshot.roles.includes(criteria.role)) {
    return false
  }

  return criteria.status === undefined || snapshot.status === criteria.status
}

const sameHumanText = (left: string, right: string): boolean =>
  left.toLowerCase() === right.toLowerCase()
