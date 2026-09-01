import { RecoveryChallenge } from '../../domain/entities/RecoveryChallenge'
import { Role } from '../../domain/entities/Role'
import { EmailAddress } from '../../domain/value-objects/EmailAddress'
import type { AccountRepositoryPort } from '../ports/AccountRepositoryPort'
import type { ClockPort } from '../ports/ClockPort'
import type { IdGeneratorPort } from '../ports/IdGeneratorPort'
import type { RecoveryChallengeRepositoryPort } from '../ports/RecoveryChallengeRepositoryPort'
import type {
  SecurityQuestion,
  SecurityQuestionCatalogPort,
} from '../ports/SecurityQuestionCatalogPort'

export interface StartPasswordRecoveryResult {
  readonly challengeToken: string
  readonly questions: readonly SecurityQuestion[]
}

/**
 * Paso 1: identifica por correo. Siempre devuelve las preguntas del catalogo
 * y un token, exista o no la cuenta, para no enumerar.
 */
export class StartPasswordRecovery {
  constructor(
    private readonly deps: {
      readonly accounts: AccountRepositoryPort
      readonly challenges: RecoveryChallengeRepositoryPort
      readonly questions: SecurityQuestionCatalogPort
      readonly ids: IdGeneratorPort
      readonly clock: ClockPort
    },
  ) {}

  async execute(emailRaw: string): Promise<StartPasswordRecoveryResult> {
    const email = EmailAddress.create(emailRaw)
    const questions = await this.deps.questions.listActive()
    const account = await this.deps.accounts.findByEmail(email)
    const eligible = account !== null && !account.hasRole(Role.SuperAdministrator)

    const challenge = RecoveryChallenge.start({
      token: this.deps.ids.generate(),
      email: email.value,
      accountId: eligible ? account.id.value : null,
      occurredAt: this.deps.clock.now(),
    })

    await this.deps.challenges.save(challenge)

    return { challengeToken: challenge.token, questions }
  }
}
