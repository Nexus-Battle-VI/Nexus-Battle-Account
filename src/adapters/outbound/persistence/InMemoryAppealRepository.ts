import type { AppealRepositoryPort } from '../../../application/ports/AppealRepositoryPort'
import type { Appeal } from '../../../domain/entities/Appeal'
import { AppealStatus } from '../../../domain/entities/AppealStatus'

export class InMemoryAppealRepository implements AppealRepositoryPort {
  private readonly appeals = new Map<string, Appeal>()

  save(appeal: Appeal): Promise<void> {
    this.appeals.set(appeal.id, appeal)

    return Promise.resolve()
  }

  findById(id: string): Promise<Appeal | null> {
    return Promise.resolve(this.appeals.get(id) ?? null)
  }

  findBySanctionId(sanctionId: string): Promise<Appeal | null> {
    const appeal = [...this.appeals.values()].find((candidate) => candidate.sanctionId === sanctionId)

    return Promise.resolve(appeal ?? null)
  }

  findByAccountId(accountId: string): Promise<readonly Appeal[]> {
    const appeals = [...this.appeals.values()]
      .filter((appeal) => appeal.accountId === accountId)
      .sort((left, right) => right.submittedAt.getTime() - left.submittedAt.getTime())

    return Promise.resolve(appeals)
  }

  findPending(): Promise<readonly Appeal[]> {
    const appeals = [...this.appeals.values()]
      .filter((appeal) => appeal.currentStatus === AppealStatus.Submitted)
      .sort((left, right) => left.submittedAt.getTime() - right.submittedAt.getTime())

    return Promise.resolve(appeals)
  }

  findAll(): readonly Appeal[] {
    return [...this.appeals.values()]
  }
}
