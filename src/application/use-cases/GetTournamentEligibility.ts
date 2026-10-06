import { AccountStatus } from '../../domain/entities/AccountStatus'
import { Role } from '../../domain/entities/Role'
import { AccountNotFoundError } from '../errors/ApplicationError'
import type { AccountRepositoryPort } from '../ports/AccountRepositoryPort'

export interface TournamentEligibility {
  readonly subject: string
  readonly displayName: string
  readonly eligible: boolean
}

/** Consulta pura: Account conserva la autoridad sobre el estado y los roles. */
export class GetTournamentEligibility {
  constructor(private readonly accounts: AccountRepositoryPort) {}

  async execute(subject: string): Promise<TournamentEligibility> {
    const account = await this.accounts.findBySubject(subject)

    if (account === null) {
      throw new AccountNotFoundError(subject, 'La cuenta no existe.')
    }

    if (account.subject !== subject) {
      throw new Error('El repositorio devolvio una cuenta de otro sujeto.')
    }

    return {
      subject: account.subject,
      displayName: account.toSnapshot().displayName,
      eligible:
        account.currentStatus === AccountStatus.Active &&
        account.currentRoles.includes(Role.Player),
    }
  }
}
