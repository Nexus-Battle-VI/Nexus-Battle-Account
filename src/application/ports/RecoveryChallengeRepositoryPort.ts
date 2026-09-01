import type { RecoveryChallenge } from '../../domain/entities/RecoveryChallenge'

export interface RecoveryChallengeRepositoryPort {
  save(challenge: RecoveryChallenge): Promise<void>
  findByToken(token: string): Promise<RecoveryChallenge | null>
}

export const RECOVERY_CHALLENGE_REPOSITORY = Symbol('RecoveryChallengeRepositoryPort')
