import { type OwnPersonalDataDto, toOwnPersonalDataDto } from '../dto/OwnPersonalDataDto'
import { AccountNotFoundError } from '../errors/ApplicationError'
import type { AccountRepositoryPort } from '../ports/AccountRepositoryPort'

/**
 * Recupera la vista de privacidad de la cuenta asociada al sujeto verificado.
 *
 * La titularidad se deriva del testimonio ya validado; no acepta ids ni datos
 * controlados por el cliente para decidir que cuenta consultar.
 */
export class GetOwnPersonalData {
  private readonly accounts: AccountRepositoryPort

  constructor(accounts: AccountRepositoryPort) {
    this.accounts = accounts
  }

  async execute(subject: string): Promise<OwnPersonalDataDto> {
    const account = await this.accounts.findBySubject(subject)

    if (account === null) {
      throw new AccountNotFoundError(
        subject,
        'El testimonio no tiene ninguna cuenta asociada en este servicio.',
      )
    }

    return toOwnPersonalDataDto(account.toSnapshot())
  }
}
