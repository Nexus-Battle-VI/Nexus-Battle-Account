import type { Appeal } from '../../domain/entities/Appeal'

export interface AppealRepositoryPort {
  save(appeal: Appeal): Promise<void>
  findById(id: string): Promise<Appeal | null>
  /** Una sancion tiene a lo sumo una apelacion: lo exige `SubmitAppeal`. */
  findBySanctionId(sanctionId: string): Promise<Appeal | null>
  findByAccountId(accountId: string): Promise<readonly Appeal[]>
  /** Apelaciones SUBMITTED, para el panel de revision (Moderador/Admin/SuperAdmin). */
  findPending(): Promise<readonly Appeal[]>
}

export const APPEAL_REPOSITORY = Symbol('AppealRepositoryPort')
