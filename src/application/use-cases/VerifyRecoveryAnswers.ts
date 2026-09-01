import { RecoveryStage } from '../../domain/entities/RecoveryChallenge'
import { AccountId } from '../../domain/value-objects/AccountId'
import { RecoveryRejectedError } from '../errors/RecoveryError'
import type { AccountRepositoryPort } from '../ports/AccountRepositoryPort'
import type { NotificationRequestPort } from '../ports/NotificationRequestPort'
import type { RecoveryChallengeRepositoryPort } from '../ports/RecoveryChallengeRepositoryPort'
import type { RecoveryOtpPort } from '../ports/RecoveryOtpPort'
import { hashSecurityAnswer } from '../security/hashSecurityAnswer'

export interface RecoveryAnswerInput {
  readonly questionId: string
  readonly answer: string
}

export interface RecoveryLog {
  info(message: string, context?: Readonly<Record<string, string | number | boolean | null>>): void
}

export class VerifyRecoveryAnswers {
  constructor(
    private readonly deps: {
      readonly accounts: AccountRepositoryPort
      readonly challenges: RecoveryChallengeRepositoryPort
      readonly otp: RecoveryOtpPort
      readonly notifications: NotificationRequestPort
      readonly logger: RecoveryLog
    },
  ) {}

  async execute(challengeToken: string, answers: readonly RecoveryAnswerInput[]): Promise<void> {
    const challenge = await this.deps.challenges.findByToken(challengeToken)

    if (challenge?.currentStage !== RecoveryStage.Identified) {
      throw new RecoveryRejectedError()
    }

    const stored =
      challenge.accountId === null
        ? []
        : await this.deps.accounts.findSecurityAnswers(AccountId.create(challenge.accountId))

    const matches = this.answersMatch(stored, answers)

    if (!challenge.isBoundToAccount || stored.length === 0 || !matches) {
      throw new RecoveryRejectedError()
    }

    const code = this.deps.otp.issue()
    challenge.markQuestionsVerified(hashSecurityAnswer(code))
    await this.deps.challenges.save(challenge)

    this.deps.logger.info('recovery_otp_issued', {
      templateId: 'account-password-recovery-code',
    })

    await this.deps.notifications.request({
      notificationId: challenge.token,
      recipient: challenge.email,
      templateId: 'account-password-recovery-code',
      variables: { code },
    })
  }

  private answersMatch(
    stored: readonly { readonly questionId: string; readonly answerHash: string }[],
    submitted: readonly RecoveryAnswerInput[],
  ): boolean {
    if (stored.length === 0 || submitted.length !== stored.length) {
      submitted.forEach((entry) => {
        try {
          hashSecurityAnswer(entry.answer)
        } catch {
          // Se hashea igual para no filtrar por tiempo si la respuesta viene vacia.
        }
      })

      return false
    }

    const byQuestion = new Map(submitted.map((entry) => [entry.questionId, entry.answer]))

    return stored.every((expected) => {
      const given = byQuestion.get(expected.questionId)

      if (given === undefined) {
        return false
      }

      return hashSecurityAnswer(given) === expected.answerHash
    })
  }
}
