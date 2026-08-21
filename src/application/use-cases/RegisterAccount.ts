import { Account } from '../../domain/entities/Account'
import { AccountId } from '../../domain/value-objects/AccountId'
import { DisplayName } from '../../domain/value-objects/DisplayName'
import { EmailAddress } from '../../domain/value-objects/EmailAddress'
import type { AccountRepositoryPort } from '../ports/AccountRepositoryPort'
import type { ClockPort } from '../ports/ClockPort'
import type { IdGeneratorPort } from '../ports/IdGeneratorPort'
import type { IdentityProviderPort } from '../ports/IdentityProviderPort'
import type { NotificationRequestPort } from '../ports/NotificationRequestPort'
import { AccountAlreadyExistsError } from '../errors/ApplicationError'
import type { RegisterAccountCommand } from '../dto/RegisterAccountCommand'
import { type AccountDto, toAccountDto } from '../dto/AccountDto'

export interface RegisterAccountDependencies {
  readonly accounts: AccountRepositoryPort
  readonly identityProvider: IdentityProviderPort
  readonly notifications: NotificationRequestPort
  readonly clock: ClockPort
  readonly ids: IdGeneratorPort
}

/**
 * Registra una cuenta nueva.
 *
 * Coordina tres colaboradores en un orden deliberado:
 *
 * 1. Se valida y se reserva la unicidad del correo.
 * 2. Se da de alta el sujeto en el proveedor de identidad.
 * 3. Se persiste la cuenta y se solicita el correo de verificacion.
 *
 * Si el proveedor de identidad falla, la cuenta no se persiste. Si la
 * persistencia falla despues de dar de alta el sujeto, se retira el sujeto
 * para no dejar identidades huerfanas: es una compensacion explicita, no una
 * transaccion distribuida.
 */
export class RegisterAccount {
  private readonly deps: RegisterAccountDependencies

  constructor(deps: RegisterAccountDependencies) {
    this.deps = deps
  }

  async execute(command: RegisterAccountCommand): Promise<AccountDto> {
    const email = EmailAddress.create(command.email)
    const displayName = DisplayName.create(command.displayName)

    if (await this.deps.accounts.existsByEmail(email)) {
      throw new AccountAlreadyExistsError(email.value)
    }

    const subject = await this.deps.identityProvider.register(email.value)

    const account = Account.register({
      id: AccountId.create(this.deps.ids.generate()),
      email,
      displayName,
      occurredAt: this.deps.clock.now(),
    })

    try {
      await this.deps.accounts.save(account)
    } catch (error: unknown) {
      await this.deps.identityProvider.revoke(subject.subject)
      throw error
    }

    // La solicitud de notificacion no participa de la compensacion: la cuenta
    // ya existe y es valida. Un fallo aqui se propaga para que el adaptador de
    // entrada lo reporte, pero no revierte el registro.
    await this.deps.notifications.request({
      notificationId: account.id.value,
      recipient: email.value,
      templateId: 'account-welcome',
      variables: { displayName: displayName.value },
    })

    account.pullEvents()

    return toAccountDto(account.toSnapshot())
  }
}
