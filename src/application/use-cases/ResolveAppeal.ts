import type { AccountRepositoryPort } from '../ports/AccountRepositoryPort'
import type { AppealRepositoryPort } from '../ports/AppealRepositoryPort'
import type { SanctionRepositoryPort } from '../ports/SanctionRepositoryPort'
import type { ClockPort } from '../ports/ClockPort'
import type { NotificationRequestPort } from '../ports/NotificationRequestPort'
import type { Appeal } from '../../domain/entities/Appeal'
import { AppealDecision, type AppealDecision as AppealDecisionValue } from '../../domain/entities/AppealDecision'
import { SanctionType } from '../../domain/entities/SanctionType'
import { AccountStatus } from '../../domain/entities/AccountStatus'
import { SanctionPolicy } from '../../domain/policies/SanctionPolicy'
import { DomainError } from '../../domain/errors/DomainError'
import { AccountId } from '../../domain/value-objects/AccountId'
import {
  AccountNotFoundError,
  AppealNotFoundError,
  SanctionNotFoundError,
} from '../errors/ApplicationError'

const APPEAL_RESOLVED_TEMPLATE = 'account-appeal-resolved'

/**
 * Decide una apelacion (HU-42, §7.3.2 "revision por parte de un panel de
 * moderadores/administradores").
 *
 * La autoridad para decidir es la MISMA que la autoridad para haber aplicado
 * ese tipo de sancion -se reutiliza `SanctionPolicy`, sin inventar una matriz
 * de permisos distinta-: un Moderador puede resolver la apelacion de una
 * advertencia o de una suspension, nunca la de un baneo.
 *
 * Un OVERTURNED revierte la restriccion de acceso -`liftBan`/`reinstate`- en
 * el mismo caso de uso que resuelve la apelacion: es la UNICA via formal para
 * anular una sancion ya aplicada, y el prompt de cierre de HU-42 exige que
 * sea asi, no silenciosa.
 */
export class ResolveAppeal {
  constructor(
    private readonly accounts: AccountRepositoryPort,
    private readonly sanctions: SanctionRepositoryPort,
    private readonly appeals: AppealRepositoryPort,
    private readonly clock: ClockPort,
    private readonly notifications: NotificationRequestPort,
  ) {}

  async execute(command: {
    readonly actorSubject: string
    readonly appealId: string
    readonly decision: AppealDecisionValue
    readonly notes: string
  }): Promise<Appeal> {
    const actor = await this.accounts.findBySubject(command.actorSubject)

    if (actor === null) {
      throw new AccountNotFoundError(
        command.actorSubject,
        'No existe la cuenta del actor que intenta resolver la apelacion.',
      )
    }

    const appeal = await this.appeals.findById(command.appealId)

    if (appeal === null) {
      throw new AppealNotFoundError(command.appealId)
    }

    if (appeal.isResolved) {
      throw new DomainError(`La apelacion ${appeal.id} ya fue resuelta.`)
    }

    const sanction = await this.sanctions.findById(appeal.sanctionId)

    if (sanction === null) {
      throw new SanctionNotFoundError(appeal.sanctionId)
    }

    if (!SanctionPolicy.canApply(new Set(actor.currentRoles), sanction.type)) {
      throw new DomainError(
        `La cuenta ${actor.id.value} no tiene permisos para resolver la apelacion de una sancion ${sanction.type}.`,
      )
    }

    const now = this.clock.now()

    appeal.resolve({
      decision: command.decision,
      notes: command.notes,
      resolvedByAccountId: actor.id.value,
      resolvedAt: now,
    })

    const target = await this.accounts.findById(AccountId.create(appeal.accountId))

    if (target === null) {
      throw new AccountNotFoundError(appeal.accountId)
    }

    if (command.decision === AppealDecision.Overturned) {
      if (sanction.type === SanctionType.PermanentBan && target.currentStatus === AccountStatus.Banned) {
        target.liftBan()
        await this.accounts.save(target)
      }

      if (
        sanction.type === SanctionType.TemporarySuspension &&
        target.currentStatus === AccountStatus.Suspended
      ) {
        target.reinstate()
        await this.accounts.save(target)
      }
    }

    await this.appeals.save(appeal)

    await this.notifications.request({
      notificationId: `appeal-resolved-${appeal.id}`,
      recipient: target.currentEmail.value,
      templateId: APPEAL_RESOLVED_TEMPLATE,
      variables: {
        displayName: target.currentDisplayName.value,
        appealId: appeal.id,
        sanctionId: sanction.id,
        sanctionType: sanction.type,
        decision: command.decision,
        resolutionNotes: command.notes,
        resolvedAt: now.toISOString(),
      },
    })

    return appeal
  }
}
