import { AccountId } from '../../domain/value-objects/AccountId'
import type { AccountRepositoryPort } from '../ports/AccountRepositoryPort'
import type { AvatarStoragePort } from '../ports/AvatarStoragePort'
import { AccountNotFoundError, AvatarNotFoundError } from '../errors/ApplicationError'

export interface AccountAvatar {
  readonly bytes: Buffer
  readonly mimeType: string
  readonly originalName: string
}

export interface GetAccountAvatarDependencies {
  readonly accounts: AccountRepositoryPort
  readonly avatars: AvatarStoragePort
}

/**
 * Resuelve el avatar real de una cuenta a partir de su identificador interno.
 *
 * Existe porque `AvatarStoragePort` solo conoce claves de almacenamiento, y
 * ningun adaptador de entrada debe traducir un identificador de cuenta a esa
 * clave por su cuenta -eso duplicaria la regla "el avatar se resuelve del
 * lado del servidor" en cada controlador que la necesitara-.
 *
 * NUNCA devuelve la clave de almacenamiento: solo los bytes y el tipo MIME
 * que el adaptador de entrada necesita para responder la imagen.
 */
export class GetAccountAvatar {
  private readonly accounts: AccountRepositoryPort
  private readonly avatars: AvatarStoragePort

  constructor(deps: GetAccountAvatarDependencies) {
    this.accounts = deps.accounts
    this.avatars = deps.avatars
  }

  async execute(id: string): Promise<AccountAvatar> {
    const account = await this.accounts.findById(AccountId.create(id))

    if (account === null) {
      throw new AccountNotFoundError(id)
    }

    const metadata = account.currentAvatar

    // Cuenta historica sin avatar recuperable: la regla vigente de registro lo
    // exige siempre, pero este caso de uso no asume que seguira siendolo -ver
    // el comentario de `AccountDto.avatarUrl`-.
    if (metadata.storageKey.trim().length === 0) {
      throw new AvatarNotFoundError(id)
    }

    const bytes = await this.avatars.read(metadata.storageKey)

    if (bytes === null) {
      throw new AvatarNotFoundError(id)
    }

    return {
      bytes,
      mimeType: metadata.mimeType,
      originalName: metadata.originalName,
    }
  }
}
