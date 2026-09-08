import { AccountNotFoundError } from '../errors/ApplicationError'
import type { AccountRepositoryPort } from '../ports/AccountRepositoryPort'
import type { IdGeneratorPort } from '../ports/IdGeneratorPort'
import type { SanctionRepositoryPort } from '../ports/SanctionRepositoryPort'
import { Sanction } from '../../domain/entities/Sanction'
import type { SanctionType } from '../../domain/entities/SanctionType'
import { SanctionPolicy } from '../../domain/policies/SanctionPolicy'
import { DomainError } from '../../domain/errors/DomainError'
import { AccountId } from '../../domain/value-objects/AccountId'

export class ApplySanction {
  constructor(
    private readonly accounts: AccountRepositoryPort,
    private readonly sanctions: SanctionRepositoryPort,
    private readonly ids: IdGeneratorPort,
  ) {}

  async execute(command: {
    readonly actorSubject: string
    readonly targetAccountId: string
    readonly type: SanctionType
    readonly reason: string
  }): Promise<Sanction> {
    const actor = await this.accounts.findBySubject(command.actorSubject)

    if (actor === null) {
      throw new AccountNotFoundError(
        command.actorSubject,
        'La identidad que intenta aplicar la sancion no tiene una cuenta.',
      )
    }

    const target = await this.accounts.findById(AccountId.create(command.targetAccountId))

    if (target === null) {
      throw new AccountNotFoundError(command.targetAccountId)
    }

    if (!SanctionPolicy.canApply(new Set(actor.currentRoles), command.type)) {
      throw new DomainError('El actor no tiene permisos para aplicar este tipo de sancion.')
    }

    const sanction = Sanction.create({
      id: this.ids.generate(),
      targetAccountId: target.id.value,
      actorAccountId: actor.id.value,
      type: command.type,
      reason: command.reason,
      createdAt: new Date(),
    })

    await this.sanctions.save(sanction)

    return sanction
  }
}
