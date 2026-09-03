import { DisplayName } from '../../domain/value-objects/DisplayName'
import { CountryCode } from '../../domain/value-objects/CountryCode'
import { DomainError } from '../../domain/errors/DomainError'
import type { AccountRepositoryPort } from '../ports/AccountRepositoryPort'
import type { NicknameBlacklistPort } from '../ports/NicknameBlacklistPort'
import {
  AccountNotFoundError,
  DisplayNameAlreadyTakenError,
  NicknameBlacklistedError,
} from '../errors/ApplicationError'
import { type AccountDto, toAccountDto } from '../dto/AccountDto'

/**
 * Actualiza la informacion personal de la cuenta propia (HU-05).
 *
 * La cuenta se identifica SIEMPRE por el sujeto del testimonio, nunca por un
 * identificador del cuerpo: es el mismo patron self-service de `GetOwnAccount`,
 * y es lo que impide que quien llama toque una cuenta ajena.
 *
 * Campos soportados: `displayName` y país opcional `countryCode` (HU-57).
 * La ampliación de país fue solicitada explícitamente para el e-commerce.
 * El apodo reutiliza las mismas reglas ya
 * aprobadas en el registro -`DisplayName` para el formato, unicidad
 * insensible a mayusculas y lista negra vigente- en lugar de introducir una
 * segunda normalizacion o duplicar la lista negra.
 *
 * `firstNames`, `lastNames`, `email` y `avatar` NO se editan aqui: HU-05 no
 * enumera en este repositorio una lista definitiva de campos editables, y
 * `changeEmail` ademas devolveria la cuenta a `PENDING_VERIFICATION` con un
 * contrato de re-verificacion que no esta aprobado. Quedan como decision
 * funcional pendiente.
 */
export class UpdateOwnAccount {
  private readonly accounts: AccountRepositoryPort
  private readonly blacklist: NicknameBlacklistPort

  constructor(accounts: AccountRepositoryPort, blacklist: NicknameBlacklistPort) {
    this.accounts = accounts
    this.blacklist = blacklist
  }

  async execute(command: {
    readonly subject: string
    readonly displayName?: string
    readonly countryCode?: string | null
  }): Promise<AccountDto> {
    const account = await this.accounts.findBySubject(command.subject)

    if (account === null) {
      throw new AccountNotFoundError(
        command.subject,
        'El testimonio no tiene ninguna cuenta asociada en este servicio.',
      )
    }

    if (command.displayName === undefined && command.countryCode === undefined) {
      throw new DomainError('Indique displayName o countryCode para actualizar el perfil.')
    }
    const displayName =
      command.displayName === undefined ? undefined : DisplayName.create(command.displayName)
    const countryCode =
      command.countryCode === undefined
        ? undefined
        : command.countryCode === null
          ? null
          : CountryCode.create(command.countryCode)

    const rename = displayName !== undefined && !account.currentDisplayName.equals(displayName)
    if (rename) {
      // Case-insensitive uniqueness applies to another owner, not this account.
      const owner = await this.accounts.findByDisplayName(displayName)
      if (owner !== null && !owner.id.equals(account.id)) {
        throw new DisplayNameAlreadyTakenError(displayName.value)
      }
      if (await this.blacklist.isBlocked(displayName.value)) throw new NicknameBlacklistedError()
    }
    const changeCountry =
      countryCode !== undefined &&
      (countryCode?.value ?? null) !== (account.currentCountryCode?.value ?? null)
    if (!rename && !changeCountry) return toAccountDto(account.toSnapshot())

    // Validate both fields before changing the aggregate; omitted fields survive.
    if (rename) account.rename(displayName)
    if (changeCountry) account.changeCountryCode(countryCode)
    await this.accounts.save(account)

    return toAccountDto(account.toSnapshot())
  }
}
