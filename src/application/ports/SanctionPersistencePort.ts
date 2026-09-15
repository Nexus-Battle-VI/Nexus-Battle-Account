import type { Account } from '../../domain/entities/Account'
import type { Sanction } from '../../domain/entities/Sanction'

export interface SanctionPersistencePort {
  saveAppliedSanction(
    sanction: Sanction,
    target: Account,
    accountStatusChanged: boolean,
  ): Promise<void>
}

export const SANCTION_PERSISTENCE = Symbol('SanctionPersistencePort')
