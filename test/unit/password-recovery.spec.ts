import { StartPasswordRecovery } from '../../src/application/use-cases/StartPasswordRecovery'
import { VerifyRecoveryAnswers } from '../../src/application/use-cases/VerifyRecoveryAnswers'
import { VerifyRecoveryCode } from '../../src/application/use-cases/VerifyRecoveryCode'
import { ResetRecoveryPassword } from '../../src/application/use-cases/ResetRecoveryPassword'
import { RecoveryRejectedError } from '../../src/application/errors/RecoveryError'
import { InMemoryAccountRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountRepository'
import { InMemoryRecoveryChallengeRepository } from '../../src/adapters/outbound/persistence/InMemoryRecoveryChallengeRepository'
import { InMemorySecurityQuestionCatalog } from '../../src/adapters/outbound/persistence/InMemorySecurityQuestionCatalog'
import { FixedRecoveryOtp } from '../../src/adapters/outbound/identity/FixedRecoveryOtp'
import { FakeAuthenticationProvider } from '../../src/adapters/outbound/identity/FakeAuthenticationProvider'
import { hashSecurityAnswer } from '../../src/application/security/hashSecurityAnswer'
import type { NotificationRequest } from '../../src/application/ports/NotificationRequestPort'
import { FOUR_ANSWERS, VALID_PASSWORD, buildAccount } from '../support/account-factory'

const AT = new Date('2026-08-31T12:00:00.000Z')

const build = () => {
  const accounts = new InMemoryAccountRepository()
  const challenges = new InMemoryRecoveryChallengeRepository()
  const questions = new InMemorySecurityQuestionCatalog()
  const otp = new FixedRecoveryOtp()
  const passwords = new FakeAuthenticationProvider(() => 'tok')
  const notifications: NotificationRequest[] = []
  const logs: string[] = []

  const start = new StartPasswordRecovery({
    accounts,
    challenges,
    questions,
    ids: {
      generate: (() => {
        let n = 0

        return (): string => {
          n += 1

          return `rec-${String(n)}`
        }
      })(),
    },
    clock: { now: (): Date => AT },
  })
  const verifyAnswers = new VerifyRecoveryAnswers({
    accounts,
    challenges,
    otp,
    notifications: {
      request: (notification): Promise<void> => {
        notifications.push(notification)

        return Promise.resolve()
      },
    },
    logger: {
      info: (message): void => {
        logs.push(message)
      },
    },
  })
  const verifyCode = new VerifyRecoveryCode(challenges)
  const reset = new ResetRecoveryPassword({
    challenges,
    passwords,
    notifications: {
      request: (notification): Promise<void> => {
        notifications.push(notification)

        return Promise.resolve()
      },
    },
  })

  return {
    accounts,
    start,
    verifyAnswers,
    verifyCode,
    reset,
    passwords,
    notifications,
    logs,
  }
}

describe('HU-04 recuperacion de contrasena', () => {
  it('el correo desconocido recibe el mismo catalogo y no avanza con respuestas', async () => {
    const { start, verifyAnswers } = build()

    const first = await start.execute('nadie@nexus.test')

    expect(first.questions).toHaveLength(4)
    await expect(verifyAnswers.execute(first.challengeToken, FOUR_ANSWERS)).rejects.toBeInstanceOf(
      RecoveryRejectedError,
    )
  })

  it('recorre los cuatro pasos y deja la nueva contrasena en el proveedor fake', async () => {
    const { accounts, start, verifyAnswers, verifyCode, reset, passwords, notifications, logs } =
      build()
    const account = buildAccount()
    await accounts.saveRegistration(
      account,
      FOUR_ANSWERS.map((entry) => ({
        questionId: entry.questionId,
        answerHash: hashSecurityAnswer(entry.answer),
      })),
    )

    const started = await start.execute(account.currentEmail.value)
    await verifyAnswers.execute(started.challengeToken, FOUR_ANSWERS)

    expect(logs).toContain('recovery_otp_issued')
    expect(notifications[0]?.templateId).toBe('account-password-recovery-code')

    await verifyCode.execute(started.challengeToken, FixedRecoveryOtp.CODE)
    await reset.execute(started.challengeToken, 'NuevaClave9!')

    expect(notifications[1]?.templateId).toBe('account-password-reset-confirmation')

    const login = await passwords.authenticate({
      email: account.currentEmail.value,
      password: 'NuevaClave9!',
    })
    expect(login.kind).toBe('authenticated')

    await expect(
      verifyCode.execute(started.challengeToken, FixedRecoveryOtp.CODE),
    ).rejects.toBeInstanceOf(RecoveryRejectedError)
  })

  it('rechaza respuestas incorrectas y un codigo ya gastado no habilita el reset', async () => {
    const { accounts, start, verifyAnswers, verifyCode, reset } = build()
    const account = buildAccount()
    await accounts.saveRegistration(
      account,
      FOUR_ANSWERS.map((entry) => ({
        questionId: entry.questionId,
        answerHash: hashSecurityAnswer(entry.answer),
      })),
    )

    const started = await start.execute(account.currentEmail.value)
    await expect(
      verifyAnswers.execute(
        started.challengeToken,
        FOUR_ANSWERS.map((entry) => ({ ...entry, answer: 'otra' })),
      ),
    ).rejects.toBeInstanceOf(RecoveryRejectedError)

    await verifyAnswers.execute(started.challengeToken, FOUR_ANSWERS)
    await expect(verifyCode.execute(started.challengeToken, '111111')).rejects.toBeInstanceOf(
      RecoveryRejectedError,
    )

    await expect(reset.execute(started.challengeToken, VALID_PASSWORD)).rejects.toBeInstanceOf(
      RecoveryRejectedError,
    )
  })
})
