import { type AccountDto, toAccountDto } from '../dto/AccountDto'
import { AccountNotFoundError } from '../errors/ApplicationError'
import type { AccountRepositoryPort } from '../ports/AccountRepositoryPort'
import type { MfaStatusPort } from '../ports/MfaStatusPort'
import { EmailAddress } from '../../domain/value-objects/EmailAddress'

export interface ManagedAccountDto extends AccountDto {
  readonly mfaEnrolled: boolean
}

export class FindAccountByEmail {
  constructor(
    private readonly accounts: AccountRepositoryPort,
    private readonly mfaStatus: MfaStatusPort,
  ) {}

  async execute(rawEmail: string): Promise<ManagedAccountDto> {
    const email = EmailAddress.create(rawEmail)
    const account = await this.accounts.findByEmail(email)

    if (account === null) {
      throw new AccountNotFoundError(email.value)
    }

    return {
      ...toAccountDto(account.toSnapshot()),
      mfaEnrolled: await this.mfaStatus.hasConfirmedTotp(account.subject),
    }
  }
}
