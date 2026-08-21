import { AccountId } from '../../domain/value-objects/AccountId'
import type { AccountRepositoryPort } from '../ports/AccountRepositoryPort'
import type { ClockPort } from '../ports/ClockPort'
import { AccountNotFoundError } from '../errors/ApplicationError'
import { type AccountDto, toAccountDto } from '../dto/AccountDto'

export interface VerifyAccountDependencies {
  readonly accounts: AccountRepositoryPort
  readonly clock: ClockPort
}

/**
 * Marca una cuenta como verificada, habilitando su autenticacion.
 *
 * La comprobacion del codigo de verificacion pertenece al proveedor de
 * identidad. Este caso de uso registra el hecho ya demostrado, no lo valida.
 */
export class VerifyAccount {
  private readonly deps: VerifyAccountDependencies

  constructor(deps: VerifyAccountDependencies) {
    this.deps = deps
  }

  async execute(id: string): Promise<AccountDto> {
    const account = await this.deps.accounts.findById(AccountId.create(id))

    if (account === null) {
      throw new AccountNotFoundError(id)
    }

    account.verify(this.deps.clock.now())
    await this.deps.accounts.save(account)
    account.pullEvents()

    return toAccountDto(account.toSnapshot())
  }
}
