import { DomainError } from '../../domain/errors/DomainError'
import { DisplayName } from '../../domain/value-objects/DisplayName'
import { AvatarNotFoundError } from '../errors/ApplicationError'
import { TournamentIdentityError } from '../errors/TournamentIdentityError'
import type { NicknameBlacklistPort } from '../ports/NicknameBlacklistPort'
import type { GetAccountAvatar } from './GetAccountAvatar'

export interface TournamentTeamIdentity {
  readonly name: string
  readonly avatar: { readonly kind: 'ACCOUNT_AVATAR'; readonly subject: string }
  readonly policyVersion: 'account-team-identity-v1'
}

/** Reutiliza las politicas vigentes sin registrar cuentas ni reservar apodos. */
export class ValidateTournamentTeamIdentity {
  constructor(
    private readonly blacklist: NicknameBlacklistPort,
    private readonly avatars: GetAccountAvatar,
  ) {}

  async execute(name: string, avatarSubject: string): Promise<TournamentTeamIdentity> {
    let displayName: DisplayName

    try {
      displayName = DisplayName.create(name)
    } catch (error: unknown) {
      if (error instanceof DomainError) {
        throw new TournamentIdentityError(
          'INVALID_TEAM_NAME',
          'El nombre del equipo no cumple la politica vigente de nombres.',
        )
      }
      throw error
    }

    if (await this.blacklist.isBlocked(displayName.value)) {
      throw new TournamentIdentityError(
        'INVALID_TEAM_NAME',
        'El nombre del equipo no esta permitido por la lista vigente.',
      )
    }

    try {
      const avatar = await this.avatars.executeBySubject(avatarSubject, { failOnUnavailable: true })
      if (avatar.bytes.length === 0) {
        throw new AvatarNotFoundError(avatarSubject)
      }
    } catch (error: unknown) {
      if (error instanceof AvatarNotFoundError) {
        throw new TournamentIdentityError(
          'INVALID_TEAM_AVATAR',
          'La cuenta seleccionada no tiene un avatar recuperable.',
        )
      }
      throw error
    }

    return {
      name: displayName.value,
      avatar: { kind: 'ACCOUNT_AVATAR', subject: avatarSubject },
      policyVersion: 'account-team-identity-v1',
    }
  }
}
