import type { RecoveryChallenge } from '../../../domain/entities/RecoveryChallenge'
import { RecoveryChallenge as Challenge } from '../../../domain/entities/RecoveryChallenge'
import type { RecoveryChallengeRepositoryPort } from '../../../application/ports/RecoveryChallengeRepositoryPort'

export class InMemoryRecoveryChallengeRepository implements RecoveryChallengeRepositoryPort {
  private readonly byToken = new Map<string, ReturnType<RecoveryChallenge['toSnapshot']>>()

  save(challenge: RecoveryChallenge): Promise<void> {
    this.byToken.set(challenge.token, challenge.toSnapshot())

    return Promise.resolve()
  }

  findByToken(token: string): Promise<RecoveryChallenge | null> {
    const snapshot = this.byToken.get(token)

    return Promise.resolve(snapshot === undefined ? null : Challenge.restore(snapshot))
  }
}
