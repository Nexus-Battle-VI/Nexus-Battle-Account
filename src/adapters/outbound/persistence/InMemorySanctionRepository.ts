import type { SanctionRepositoryPort } from '../../../application/ports/SanctionRepositoryPort'
import type { Sanction } from '../../../domain/entities/Sanction'
import { SanctionType } from '../../../domain/entities/SanctionType'

export class InMemorySanctionRepository implements SanctionRepositoryPort {
  private readonly sanctions = new Map<string, Sanction>()

  save(sanction: Sanction): Promise<void> {
    this.sanctions.set(sanction.id, sanction)

    return Promise.resolve()
  }

  findActiveTemporarySuspension(targetAccountId: string, at: Date): Promise<Sanction | null> {
    const suspension = [...this.sanctions.values()]
      .filter(
        (sanction) =>
          sanction.targetAccountId === targetAccountId &&
          sanction.type === SanctionType.TemporarySuspension &&
          sanction.expiresAt !== null &&
          sanction.expiresAt.getTime() > at.getTime(),
      )
      .sort((left, right) => {
        const leftExpiration = left.expiresAt?.getTime() ?? 0
        const rightExpiration = right.expiresAt?.getTime() ?? 0

        return rightExpiration - leftExpiration
      })[0]

    return Promise.resolve(suspension ?? null)
  }

  findLatestTemporarySuspension(targetAccountId: string): Promise<Sanction | null> {
    const suspension = [...this.sanctions.values()]
      .filter(
        (sanction) =>
          sanction.targetAccountId === targetAccountId &&
          sanction.type === SanctionType.TemporarySuspension,
      )
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0]

    return Promise.resolve(suspension ?? null)
  }

  findAll(): readonly Sanction[] {
    return [...this.sanctions.values()]
  }
}
