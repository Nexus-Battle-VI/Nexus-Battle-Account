import type { Sanction } from '../../domain/entities/Sanction'

export interface SanctionRepositoryPort {
  save(sanction: Sanction): Promise<void>

  /** Subconjunto sin duplicados de los IDs consultados que recibieron alguna sancion. */
  findAccountIdsWithHistory(accountIds: readonly string[]): Promise<readonly string[]>

  findActiveTemporarySuspension(targetAccountId: string, at: Date): Promise<Sanction | null>

  findLatestTemporarySuspension(targetAccountId: string): Promise<Sanction | null>
}

export const SANCTION_REPOSITORY = Symbol('SanctionRepositoryPort')
