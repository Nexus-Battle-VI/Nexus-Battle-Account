import { AccountId } from '../../domain/value-objects/AccountId'
import type { AccountRepositoryPort } from '../ports/AccountRepositoryPort'
import { AccountNotFoundError } from '../errors/ApplicationError'
import { type AccountDto, toAccountDto } from '../dto/AccountDto'

/**
 * Recupera una cuenta por su identificador.
 */
export class GetAccount {
  private readonly accounts: AccountRepositoryPort

  constructor(accounts: AccountRepositoryPort) {
    this.accounts = accounts
  }

  async execute(id: string): Promise<AccountDto> {
    const account = await this.accounts.findById(AccountId.create(id))

    if (account === null) {
      throw new AccountNotFoundError(id)
    }

    return toAccountDto(account.toSnapshot())
  }
}
