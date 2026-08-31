import { RecoveryStage } from '../../domain/entities/RecoveryChallenge'
import { PasswordPolicy } from '../../domain/policies/PasswordPolicy'
import { RecoveryPasswordResetError, RecoveryRejectedError } from '../errors/RecoveryError'
import type { IdentityPasswordResetPort } from '../ports/IdentityPasswordResetPort'
import type { NotificationRequestPort } from '../ports/NotificationRequestPort'
import type { RecoveryChallengeRepositoryPort } from '../ports/RecoveryChallengeRepositoryPort'

export class ResetRecoveryPassword {
  constructor(
    private readonly deps: {
      readonly challenges: RecoveryChallengeRepositoryPort
      readonly passwords: IdentityPasswordResetPort
      readonly notifications: NotificationRequestPort
    },
  ) {}

  async execute(challengeToken: string, password: string): Promise<void> {
    const challenge = await this.deps.challenges.findByToken(challengeToken)

    if (challenge?.currentStage !== RecoveryStage.CodeVerified) {
      throw new RecoveryRejectedError()
    }

    PasswordPolicy.assertValid(password)

    const outcome = await this.deps.passwords.setPassword(challenge.email, password)

    if (outcome.kind !== 'updated') {
      throw new RecoveryPasswordResetError()
    }

    challenge.markCompleted()
    await this.deps.challenges.save(challenge)

    await this.deps.notifications.request({
      notificationId: `${challenge.token}-confirmed`,
      recipient: challenge.email,
      templateId: 'account-password-reset-confirmation',
      variables: { email: challenge.email },
    })
  }
}
