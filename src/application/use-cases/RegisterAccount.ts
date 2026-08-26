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
 *
 * La compensacion alcanza UNICAMENTE al sujeto que este caso de uso creo.
 * Cuando el sujeto llega ya verificado en el testimonio, no se da de alta y
 * tampoco se revoca: retirarlo dejaria sin identidad a alguien que la tenia
 * antes de esta peticion.
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

    // Si quien registra llega con un testimonio verificado, el sujeto YA existe
    // en el proveedor: darlo de alta otra vez produciria dos identidades para la
    // misma persona.
    const provided = command.subject?.trim() ?? ''
    const createdSubject =
      provided.length > 0 ? null : (await this.deps.identityProvider.register(email.value)).subject
    const subject = createdSubject ?? provided

    const account = Account.register({
      id: AccountId.create(this.deps.ids.generate()),
      subject,
      email,
      displayName,
      occurredAt: this.deps.clock.now(),
    })

    try {
      await this.deps.accounts.save(account)
    } catch (error: unknown) {
      // Solo se retira lo que este caso de uso creo. Revocar un sujeto ajeno
      // dejaria sin identidad a alguien que ya la tenia antes de esta peticion.
      if (createdSubject !== null) {
        await this.deps.identityProvider.revoke(createdSubject)
      }

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
