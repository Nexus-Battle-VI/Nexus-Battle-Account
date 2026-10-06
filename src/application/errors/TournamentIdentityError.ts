export type TournamentIdentityErrorCode = 'INVALID_TEAM_NAME' | 'INVALID_TEAM_AVATAR'

export class TournamentIdentityError extends Error {
  constructor(
    readonly code: TournamentIdentityErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'TournamentIdentityError'
  }
}
