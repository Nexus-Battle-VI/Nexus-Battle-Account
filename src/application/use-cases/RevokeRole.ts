import { type AccountDto, toAccountDto } from '../dto/AccountDto'
import { AccountNotFoundError } from '../errors/ApplicationError'
import type { AccountRepositoryPort } from '../ports/AccountRepositoryPort'
import type { RoleDirectoryPort } from '../ports/RoleDirectoryPort'
import type { SessionRevocationPort } from '../ports/SessionRevocationPort'
import { Role } from '../../domain/entities/Role'
import { DomainError } from '../../domain/errors/DomainError'
import { AccountId } from '../../domain/value-objects/AccountId'

export class RevokeRole {
  constructor(
    private readonly accounts: AccountRepositoryPort,
    private readonly roleDirectory: RoleDirectoryPort,
    private readonly sessionRevocation: SessionRevocationPort,
  ) {}

  async execute(command: {
    readonly actorSubject: string
    readonly targetAccountId: string
    readonly role: Role
  }): Promise<AccountDto> {
    const actor = await this.accounts.findBySubject(command.actorSubject)
    if (actor === null) {
      throw new AccountNotFoundError(
        command.actorSubject,
        'La identidad que intenta gestionar roles no tiene una cuenta.',
      )
    }

    const target = await this.accounts.findById(AccountId.create(command.targetAccountId))
    if (target === null) {
      throw new AccountNotFoundError(command.targetAccountId)
    }

    if (command.role === Role.SuperAdministrator && actor.subject === target.subject) {
      throw new DomainError('Un Super Administrador no puede retirar su propio rol raiz.')
    }

    const wasAssigned = target.hasRole(command.role)
    target.revokeRole(command.role, new Set(actor.currentRoles))

    if (wasAssigned) {
      // Al retirar, Cognito va primero: un fallo deja la fuente de verdad sin
      // cambios y evita privilegios en el testimonio sin respaldo en la base.
      await this.roleDirectory.reflect(target.subject, target.currentRoles)
      await this.accounts.save(target)
      await this.sessionRevocation.globalSignOut(target.subject)
    }

    return toAccountDto(target.toSnapshot())
  }
}
