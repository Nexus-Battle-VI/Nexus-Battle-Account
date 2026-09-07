import { AccountNotFoundError } from '../errors/ApplicationError'
import type { AccountRepositoryPort } from '../ports/AccountRepositoryPort'
import type { ClockPort } from '../ports/ClockPort'
import type { IdGeneratorPort } from '../ports/IdGeneratorPort'
import type { SanctionPersistencePort } from '../ports/SanctionPersistencePort'
import { Sanction } from '../../domain/entities/Sanction'
import {
  SanctionType,
  type SanctionType as SanctionTypeValue,
} from '../../domain/entities/SanctionType'
import { SanctionPolicy } from '../../domain/policies/SanctionPolicy'
import { DomainError } from '../../domain/errors/DomainError'
import { AccountId } from '../../domain/value-objects/AccountId'

export class ApplySanction {
  constructor(
    private readonly accounts: AccountRepositoryPort,
    private readonly persistence: SanctionPersistencePort,
    private readonly ids: IdGeneratorPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(command: {
    readonly actorSubject: string
    readonly targetAccountId: string
    readonly type: SanctionTypeValue
    readonly reason: string
    readonly suspensionDurationMinutes?: number
  }): Promise<Sanction> {
    const actor = await this.accounts.findBySubject(command.actorSubject)

    if (actor === null) {
      throw new AccountNotFoundError(
        command.actorSubject,
        'No existe la cuenta del actor que intenta aplicar la sancion.',
      )
    }

    const target = await this.accounts.findById(
      AccountId.create(command.targetAccountId),
    )

    if (target === null) {
      throw new AccountNotFoundError(command.targetAccountId)
    }

    if (!SanctionPolicy.canApply(new Set(actor.currentRoles), command.type)) {
      throw new DomainError(
        `La cuenta ${actor.id.value} no puede aplicar una sancion ${command.type}.`,
      )
    }

    const createdAt = this.clock.now()
    let expiresAt: Date | null = null

    if (command.type === SanctionType.TemporarySuspension) {
      const duration = command.suspensionDurationMinutes

      if (
        duration === undefined ||
        !Number.isInteger(duration) ||
        duration <= 0
      ) {
        throw new DomainError(
          'La suspension temporal debe indicar una duracion valida en minutos.',
        )
      }

      expiresAt = new Date(createdAt.getTime() + duration * 60_000)
    }

    if (
      command.type !== SanctionType.TemporarySuspension &&
      command.suspensionDurationMinutes !== undefined
    ) {
      throw new DomainError(
        'Solo una suspension temporal puede indicar una duracion.',
      )
    }

    const sanction = Sanction.create({
      id: this.ids.generate(),
      targetAccountId: target.id.value,
      actorAccountId: actor.id.value,
      type: command.type,
      reason: command.reason,
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

    await this.persistence.saveAppliedSanction(
      sanction,
      target,
      accountStatusChanged,
    )

    return sanction
  }
}