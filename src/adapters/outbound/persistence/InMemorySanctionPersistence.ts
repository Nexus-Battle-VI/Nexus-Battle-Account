import type { SanctionPersistencePort } from '../../../application/ports/SanctionPersistencePort'
import type { AccountRepositoryPort } from '../../../application/ports/AccountRepositoryPort'
import type { SanctionRepositoryPort } from '../../../application/ports/SanctionRepositoryPort'
import type { Account } from '../../../domain/entities/Account'
import type { Sanction } from '../../../domain/entities/Sanction'

export class InMemorySanctionPersistence implements SanctionPersistencePort {
  constructor(
    private readonly accounts: AccountRepositoryPort,
    private readonly sanctions: SanctionRepositoryPort,
  ) {}

  async saveAppliedSanction(
    sanction: Sanction,
    target: Account,
    accountStatusChanged: boolean,
  ): Promise<void> {
    if (accountStatusChanged) {
      await this.accounts.save(target)
    }

    await this.sanctions.save(sanction)
  }
}