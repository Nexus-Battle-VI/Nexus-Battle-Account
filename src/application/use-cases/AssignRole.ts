import { type AccountDto, toAccountDto } from '../dto/AccountDto'
import { AccountNotFoundError } from '../errors/ApplicationError'
import type { AccountRepositoryPort } from '../ports/AccountRepositoryPort'
import type { MfaStatusPort } from '../ports/MfaStatusPort'
import type { RoleDirectoryPort } from '../ports/RoleDirectoryPort'
import { Role, isAdministrativeRole } from '../../domain/entities/Role'
import { DomainError } from '../../domain/errors/DomainError'
import { AccountId } from '../../domain/value-objects/AccountId'

export type AssignRoleOutcome =
  { readonly kind: 'assigned'; readonly account: AccountDto } | { readonly kind: 'mfaRequired' }

export class AssignRole {
  constructor(
    private readonly accounts: AccountRepositoryPort,
    private readonly roleDirectory: RoleDirectoryPort,
    private readonly mfaStatus: MfaStatusPort,
  ) {}

  async execute(command: {
    readonly actorSubject: string
    readonly targetAccountId: string
    readonly role: Role
  }): Promise<AssignRoleOutcome> {
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

    if (command.role === Role.SuperAdministrator) {
      throw new DomainError('El rol SUPER_ADMINISTRATOR no se concede mediante la API.')
    }

    const alreadyAssigned = target.hasRole(command.role)
    // La entidad aplica la autorizacion aun en el camino idempotente. Asi el
    // caso de uso no duplica la politica ni permite que otro actor la evada.
    target.grantRole(command.role, new Set(actor.currentRoles))

    if (alreadyAssigned) {
      return { kind: 'assigned', account: toAccountDto(target.toSnapshot()) }
    }

    if (
      isAdministrativeRole([command.role]) &&
      !(await this.mfaStatus.hasConfirmedTotp(target.subject))
    ) {
      return { kind: 'mfaRequired' }
    }

    // Fuente de verdad primero. Si Cognito falla despues, ningun testimonio
    // nuevo lleva el rol y el estado intermedio deniega.
    await this.accounts.save(target)
    await this.roleDirectory.reflect(target.subject, target.currentRoles)

    return { kind: 'assigned', account: toAccountDto(target.toSnapshot()) }
  }
}
