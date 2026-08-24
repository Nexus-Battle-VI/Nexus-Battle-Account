import { DomainError } from '../../domain/errors/DomainError'
import { AccountId } from '../../domain/value-objects/AccountId'
import type { AccountPersonalDataDto } from '../dto/AccountPersonalDataDto'
import {
  AuthenticationRequiredError,
  PersonalDataUnavailableError,
} from '../errors/ApplicationError'
import type { AccountRepositoryPort } from '../ports/AccountRepositoryPort'
import type { AuthenticatedPrincipal } from '../security/AuthenticatedPrincipal'

export class GetOwnPersonalData {
  private readonly accounts: AccountRepositoryPort

  constructor(accounts: AccountRepositoryPort) {
    this.accounts = accounts
  }

  async execute(
    principal: AuthenticatedPrincipal | null | undefined,
  ): Promise<AccountPersonalDataDto> {
    if (principal == null) {
      throw new AuthenticationRequiredError()
    }

    const accountId = GetOwnPersonalData.accountIdFrom(principal)
    const account = await this.accounts.findById(accountId)

    if (account === null) {
      throw new PersonalDataUnavailableError()
    }

    return {
      email: account.currentEmail.value,
      displayName: account.currentDisplayName.value,
    }
  }

  private static accountIdFrom(principal: AuthenticatedPrincipal): AccountId {
    try {
      return AccountId.create(principal.accountId)
    } catch (error: unknown) {
      if (error instanceof DomainError) {
        throw new PersonalDataUnavailableError()
      }

      throw error
    }
  }
}
