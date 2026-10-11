import type { AppealRepositoryPort } from '../ports/AppealRepositoryPort'
import type { Appeal } from '../../domain/entities/Appeal'

/** Consulta de autoservicio: las apelaciones de la propia cuenta, mas recientes primero. */
export class GetMyAppealStatus {
  constructor(private readonly appeals: AppealRepositoryPort) {}

  async execute(accountId: string): Promise<readonly Appeal[]> {
    return this.appeals.findByAccountId(accountId)
  }
}
