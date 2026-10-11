import type { AppealRepositoryPort } from '../ports/AppealRepositoryPort'
import type { SanctionRepositoryPort } from '../ports/SanctionRepositoryPort'
import type { AccountRepositoryPort } from '../ports/AccountRepositoryPort'
import type { ClockPort } from '../ports/ClockPort'
import type { IdGeneratorPort } from '../ports/IdGeneratorPort'
import type { NotificationRequestPort } from '../ports/NotificationRequestPort'
import { Appeal } from '../../domain/entities/Appeal'
import { DomainError } from '../../domain/errors/DomainError'
import { AccountId } from '../../domain/value-objects/AccountId'
import { AccountNotFoundError, SanctionNotFoundError } from '../errors/ApplicationError'

const APPEAL_RECEIVED_TEMPLATE = 'account-appeal-received'

/**
 * Presenta una apelacion sobre una sancion propia (HU-42, §7.3.2: "plazo de
 * 30 dias para presentar apelacion"). El accountId llega del
 * `AppealAccessGuard`, nunca del cuerpo de la peticion: igual que
 * `ApplySanction` nunca lee el rol del cuerpo, esto evita que alguien apele
 * una sancion ajena declarando otra cuenta.
 */
export class SubmitAppeal {
  constructor(
    private readonly accounts: AccountRepositoryPort,
    private readonly sanctions: SanctionRepositoryPort,
    private readonly appeals: AppealRepositoryPort,
    private readonly ids: IdGeneratorPort,
    private readonly clock: ClockPort,
    private readonly notifications: NotificationRequestPort,
  ) {}

  async execute(command: {
    readonly accountId: string
    readonly sanctionId: string
    readonly statement: string
  }): Promise<Appeal> {
    const sanction = await this.sanctions.findById(command.sanctionId)

    if (sanction === null) {
      throw new SanctionNotFoundError(command.sanctionId)
    }

    if (sanction.targetAccountId !== command.accountId) {
      throw new DomainError('Solo el titular sancionado puede apelar esta sancion.')
    }

    const now = this.clock.now()

    if (!sanction.canAppeal(now)) {
      throw new DomainError('El plazo de 30 dias para apelar esta sancion ya vencio.')
    }

    const existing = await this.appeals.findBySanctionId(command.sanctionId)

    if (existing !== null) {
      throw new DomainError('Esta sancion ya tiene una apelacion presentada.')
    }

    const target = await this.accounts.findById(AccountId.create(command.accountId))

    if (target === null) {
      throw new AccountNotFoundError(command.accountId)
    }

    const appeal = Appeal.submit({
      id: this.ids.generate(),
      sanctionId: command.sanctionId,
      accountId: command.accountId,
      statement: command.statement,
      submittedAt: now,
    })

    await this.appeals.save(appeal)

    await this.notifications.request({
      notificationId: `appeal-received-${appeal.id}`,
      recipient: target.currentEmail.value,
      templateId: APPEAL_RECEIVED_TEMPLATE,
      variables: {
        displayName: target.currentDisplayName.value,
        appealId: appeal.id,
        sanctionId: sanction.id,
        sanctionType: sanction.type,
        submittedAt: appeal.submittedAt.toISOString(),
        decisionDueAt: appeal.decisionDueAt.toISOString(),
      },
    })

    return appeal
  }
}
