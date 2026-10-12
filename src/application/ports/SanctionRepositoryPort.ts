import type { Sanction } from '../../domain/entities/Sanction'

export interface SanctionRepositoryPort {
  save(sanction: Sanction): Promise<void>

  findById(id: string): Promise<Sanction | null>

  /** Subconjunto sin duplicados de los IDs consultados que recibieron alguna sancion. */
  findAccountIdsWithHistory(accountIds: readonly string[]): Promise<readonly string[]>

  findActiveTemporarySuspension(targetAccountId: string, at: Date): Promise<Sanction | null>

  /** Vetos permanentes y suspensiones temporales vigentes en `at`, sin advertencias. */
  findActiveRestrictions(targetAccountId: string, at: Date): Promise<readonly Sanction[]>

  findLatestTemporarySuspension(targetAccountId: string): Promise<Sanction | null>

  /**
   * Historial COMPLETO de una cuenta (advertencias incluidas, vencidas o no).
   * Existe para HU-42 §6: quien se autentica con identidad restringida
   * necesita ver que puede apelar sin tener que conocer de antemano el id de
   * una sancion concreta.
   */
  findByTargetAccountId(targetAccountId: string): Promise<readonly Sanction[]>
}

export const SANCTION_REPOSITORY = Symbol('SanctionRepositoryPort')
