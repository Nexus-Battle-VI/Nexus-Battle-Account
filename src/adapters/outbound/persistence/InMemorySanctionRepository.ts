import type { SanctionRepositoryPort } from '../../../application/ports/SanctionRepositoryPort'
import type { Sanction } from '../../../domain/entities/Sanction'

export class InMemorySanctionRepository implements SanctionRepositoryPort {
  private readonly sanctions = new Map<string, Sanction>()

  save(sanction: Sanction): Promise<void> {
    this.sanctions.set(sanction.id, sanction)

    return Promise.resolve()
  }

  findAll(): readonly Sanction[] {
    return [...this.sanctions.values()]
  }
}