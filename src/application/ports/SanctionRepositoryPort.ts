import type { Sanction } from '../../domain/entities/Sanction'

export interface SanctionRepositoryPort {
  save(sanction: Sanction): Promise<void>
}

export const SANCTION_REPOSITORY = Symbol('SanctionRepositoryPort')