import { AccountNotFoundError } from '../errors/ApplicationError'
import type { AccountRepositoryPort } from '../ports/AccountRepositoryPort'
import type { ClockPort } from '../ports/ClockPort'
import type { IdGeneratorPort } from '../ports/IdGeneratorPort'
import type { NotificationRequestPort } from '../ports/NotificationRequestPort'
import type { SanctionPersistencePort } from '../ports/SanctionPersistencePort'
import type { SessionRevocationPort } from '../ports/SessionRevocationPort'
import { Sanction } from '../../domain/entities/Sanction'
import {
  SanctionType,
  type SanctionType as SanctionTypeValue,
} from '../../domain/entities/SanctionType'
import type { SanctionReasonCode } from '../../domain/entities/SanctionReasonCode'
import { SanctionPolicy } from '../../domain/policies/SanctionPolicy'
import { DomainError } from '../../domain/errors/DomainError'
import { AccountId } from '../../domain/value-objects/AccountId'

const SANCTION_NOTIFICATION_TEMPLATE = 'account-sanction-applied'

const APPEAL_WINDOW_DAYS = 30

/** Mismo contrato minimo que `ProcessAccountDeletionLog`: info/warn/error con contexto plano. */
export interface ApplySanctionLog {
  warn(message: string, context?: Readonly<Record<string, string | number | boolean | null>>): void
}

export class ApplySanction {
  constructor(
    private readonly accounts: AccountRepositoryPort,
    private readonly persistence: SanctionPersistencePort,
    private readonly ids: IdGeneratorPort,
    private readonly clock: ClockPort,
    private readonly notifications: NotificationRequestPort,
    private readonly sessionRevocation: SessionRevocationPort,
    private readonly logger: ApplySanctionLog,
  ) {}

  async execute(command: {
    readonly actorSubject: string
    readonly targetAccountId: string
    readonly type: SanctionTypeValue
    readonly reason: string
    readonly reasonCode: SanctionReasonCode
    readonly suspensionDurationMinutes?: number
  }): Promise<Sanction> {
    const actor = await this.accounts.findBySubject(command.actorSubject)

    if (actor === null) {
      throw new AccountNotFoundError(
        command.actorSubject,
        'No existe la cuenta del actor que intenta aplicar la sancion.',
      )
    }

    const target = await this.accounts.findById(AccountId.create(command.targetAccountId))

    if (target === null) {
      throw new AccountNotFoundError(command.targetAccountId)
    }

    if (!SanctionPolicy.canApply(new Set(actor.currentRoles), command.type)) {
      throw new DomainError(
        `La cuenta ${actor.id.value} no tiene permisos para aplicar una sancion ${command.type}.`,
      )
    }
    const createdAt = this.clock.now()

    let expiresAt: Date | null = null

    if (command.type === SanctionType.TemporarySuspension) {
      const duration = command.suspensionDurationMinutes

      if (duration === undefined || !Number.isInteger(duration) || duration <= 0) {
        throw new DomainError('La suspension temporal debe indicar una duracion valida en minutos.')
      }

      expiresAt = new Date(createdAt.getTime() + duration * 60_000)
    }

    if (
      command.type !== SanctionType.TemporarySuspension &&
      command.suspensionDurationMinutes !== undefined
    ) {
      throw new DomainError('Solo una suspension temporal puede indicar una duracion.')
    }

    const sanction = Sanction.create({
      id: this.ids.generate(),
      targetAccountId: target.id.value,
      actorAccountId: actor.id.value,
      type: command.type,
      reason: command.reason,
      reasonCode: command.reasonCode,
      createdAt,
      expiresAt,
    })

    let accountStatusChanged = false

    if (command.type === SanctionType.TemporarySuspension) {
      target.suspend()
      accountStatusChanged = true
    }

    if (command.type === SanctionType.PermanentBan) {
      target.ban()
      accountStatusChanged = true
    }

    await this.persistence.saveAppliedSanction(sanction, target, accountStatusChanged)

    if (accountStatusChanged) {
      // Una suspension o un baneo deben cerrar las sesiones ya abiertas, no
      // solo impedir una futura: sin esto, un testimonio emitido antes de la
      // sancion seguiria sirviendo hasta su `exp` (ADR-004). Igual que
      // RevokeRole, va despues de persistir: un fallo aqui no deja la sancion
      // sin aplicar.
      //
      // A DIFERENCIA de RevokeRole, el fallo NO se propaga. La sancion ya es
      // real -persistida y aplicada en `target`- y cada peticion protegida
      // ya la respeta por su cuenta (`JwtAuthGuard` vuelve a comprobar el
      // estado en cada llamada, no solo al emitir el testimonio). Dejar que
      // un fallo transitorio del proveedor de identidad aqui abortara TODO
      // el caso de uso tendria dos efectos peores que perder esta
      // revocacion puntual: el admin veria un 500 sobre una sancion que SI
      // se aplico, y la notificacion -mas abajo- ni siquiera se intentaria.
      try {
        await this.sessionRevocation.globalSignOut(target.subject)
      } catch (error: unknown) {
        this.logger.warn('apply_sanction_session_revocation_failed', {
          sanctionId: sanction.id,
          targetAccountId: target.id.value,
          detail: error instanceof Error ? error.message : 'fallo desconocido',
        })
      }
    }

    await this.notifications.request({
      notificationId: `sanction-${sanction.id}`,
      recipient: target.currentEmail.value,
      templateId: SANCTION_NOTIFICATION_TEMPLATE,
      variables: {
        displayName: target.currentDisplayName.value,
        sanctionId: sanction.id,
        sanctionType: sanction.type,
        reason: sanction.reason,
        appliedAt: sanction.createdAt.toISOString(),
        appealDeadline: sanction.appealDeadline.toISOString(),
        appealWindowDays: APPEAL_WINDOW_DAYS,
        expiresAt: sanction.expiresAt?.toISOString() ?? '',
      },
    })

    return sanction
  }
}
