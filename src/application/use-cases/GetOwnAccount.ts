import type { AccountRepositoryPort } from '../ports/AccountRepositoryPort'
import { AccountNotFoundError } from '../errors/ApplicationError'
import { type AccountDto, toAccountDto } from '../dto/AccountDto'

/**
 * Recupera la cuenta vinculada a un sujeto del proveedor de identidad.
 *
 * Existe para que quien pregunta no necesite conocer ningun identificador
 * interno: el testimonio ya dice quien es. Es lo que permite que la lectura de
 * la propia cuenta no requiera exponer identificadores ajenos ni confiar en
 * que el cliente indique el suyo correctamente.
 */
export class GetOwnAccount {
  private readonly accounts: AccountRepositoryPort

  constructor(accounts: AccountRepositoryPort) {
    this.accounts = accounts
  }

  async execute(subject: string): Promise<AccountDto> {
    const account = await this.accounts.findBySubject(subject)

    if (account === null) {
      throw new AccountNotFoundError(
        subject,
        'El testimonio no tiene ninguna cuenta asociada en este servicio.',
      )
    }

    return toAccountDto(account.toSnapshot())
  }
}
