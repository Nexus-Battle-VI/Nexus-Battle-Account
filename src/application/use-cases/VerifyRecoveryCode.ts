import { RecoveryStage } from '../../domain/entities/RecoveryChallenge'
import { RecoveryRejectedError } from '../errors/RecoveryError'
import type { RecoveryChallengeRepositoryPort } from '../ports/RecoveryChallengeRepositoryPort'
import { hashSecurityAnswer } from '../security/hashSecurityAnswer'

export class VerifyRecoveryCode {
  constructor(private readonly challenges: RecoveryChallengeRepositoryPort) {}

  async execute(challengeToken: string, code: string): Promise<void> {
    const challenge = await this.challenges.findByToken(challengeToken)

    if (
      challenge?.currentStage !== RecoveryStage.QuestionsVerified ||
      challenge.currentCodeHash === null
    ) {
      throw new RecoveryRejectedError()
    }

    let submittedHash: string

    try {
      submittedHash = hashSecurityAnswer(code)
    } catch {
      throw new RecoveryRejectedError()
    }

    if (submittedHash !== challenge.currentCodeHash) {
      throw new RecoveryRejectedError()
    }

    challenge.markCodeVerified()
    await this.challenges.save(challenge)
  }
}
