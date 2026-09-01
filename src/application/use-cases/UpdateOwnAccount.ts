import { DisplayName } from '../../domain/value-objects/DisplayName'
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
 * Campo soportado: `displayName` (apodo). Reutiliza las mismas reglas ya
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
    readonly displayName: string
  }): Promise<AccountDto> {
    const account = await this.accounts.findBySubject(command.subject)

    if (account === null) {
      throw new AccountNotFoundError(
        command.subject,
        'El testimonio no tiene ninguna cuenta asociada en este servicio.',
      )
    }

    const displayName = DisplayName.create(command.displayName)

    // Edicion idempotente del MISMO valor: nada que comprobar ni que guardar.
    // Sin esta salida, un apodo identico al actual iria a la comprobacion de
    // unicidad y chocaria consigo mismo.
    if (account.currentDisplayName.equals(displayName)) {
      return toAccountDto(account.toSnapshot())
    }

    // La colision se decide por PROPIETARIO, no por existencia: cambiar solo
    // las mayusculas del propio apodo ("Ana" -> "ANA") lo encontraria el indice
    // insensible a mayusculas y seria un falso choque con uno mismo.
    const owner = await this.accounts.findByDisplayName(displayName)

    if (owner !== null && !owner.id.equals(account.id)) {
      throw new DisplayNameAlreadyTakenError(displayName.value)
    }

    if (await this.blacklist.isBlocked(displayName.value)) {
      throw new NicknameBlacklistedError()
    }

    account.rename(displayName)
    await this.accounts.save(account)

    return toAccountDto(account.toSnapshot())
  }
}
