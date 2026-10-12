import type { AppealRepositoryPort } from '../ports/AppealRepositoryPort'
import type { Appeal } from '../../domain/entities/Appeal'

/** Panel de revision (Moderador/Administrador/Super Administrador): apelaciones sin decidir. */
export class ListAppealsForReview {
  constructor(private readonly appeals: AppealRepositoryPort) {}

  async execute(): Promise<readonly Appeal[]> {
    return this.appeals.findPending()
  }
}
