import { resolveAccountByIdentifier } from './AccountIdentifierResolver'
import { toAccountDto, type AccountDto } from '../dto/AccountDto'
import { IdentitySignUpError, type IdentitySignUpPort } from '../ports/IdentitySignUpPort'
import type { AccountRepositoryPort } from '../ports/AccountRepositoryPort'
import type { ClockPort } from '../ports/ClockPort'

export interface ConfirmRegistrationCommand {
  readonly identifier: string
  readonly code: string
}

export type ConfirmRegistrationOutcome =
  | { readonly kind: 'confirmed'; readonly account: AccountDto }
  | { readonly kind: 'invalidCode' }
  | { readonly kind: 'providerUnavailable' }

export interface ConfirmRegistrationDependencies {
  readonly accounts: AccountRepositoryPort
  readonly identitySignUp: IdentitySignUpPort
  readonly clock: ClockPort
}

/**
 * Confirma el correo con el codigo que envio el proveedor y ACTIVA la cuenta.
 *
 * Segunda mitad del alta server-side: `RegisterAccount` creo la identidad y la
 * cuenta pendiente; esto cierra el circulo. La verificacion del buzon la hace
 * Cognito -comprueba el codigo-; Account solo refleja ese hecho en el estado de
 * la cuenta.
 */
export class ConfirmRegistration {
  private readonly deps: ConfirmRegistrationDependencies

  constructor(deps: ConfirmRegistrationDependencies) {
    this.deps = deps
  }

  async execute(command: ConfirmRegistrationCommand): Promise<ConfirmRegistrationOutcome> {
    const account = await resolveAccountByIdentifier(this.deps.accounts, command.identifier)

    // Cuenta inexistente responde IGUAL que un codigo invalido, por el mismo
    // motivo que en el login: no permitir enumerar cuentas por su estado.
    if (account === null) {
      return { kind: 'invalidCode' }
    }

    let outcome: Awaited<ReturnType<IdentitySignUpPort['confirmSignUp']>>

    try {
      outcome = await this.deps.identitySignUp.confirmSignUp(
        account.currentEmail.value,
        command.code,
      )
    } catch (error: unknown) {
      if (error instanceof IdentitySignUpError) {
        return { kind: 'providerUnavailable' }
      }

      throw error
    }

    if (outcome.kind === 'invalidCode' || outcome.kind === 'expired') {
      return { kind: 'invalidCode' }
    }

    /**
     * `confirmed` y `alreadyConfirmed` se tratan igual: en ambos el correo esta
     * verificado en el proveedor, y activar una cuenta ya activa no hace dano.
     * Es lo que permite reintentar la confirmacion sin error si la primera
     * respuesta se perdio.
     */
    if (account.canAuthenticate) {
      return { kind: 'confirmed', account: toAccountDto(account.toSnapshot()) }
    }

    account.verify(this.deps.clock.now())
    await this.deps.accounts.save(account)
    account.pullEvents()

    return { kind: 'confirmed', account: toAccountDto(account.toSnapshot()) }
  }
}
