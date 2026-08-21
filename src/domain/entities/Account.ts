import { DomainError } from '../errors/DomainError'
import type { AccountId } from '../value-objects/AccountId'
import type { EmailAddress } from '../value-objects/EmailAddress'
import type { DisplayName } from '../value-objects/DisplayName'
import { AccountStatus } from './AccountStatus'
import type { Role } from './Role'
import { RolePolicy } from '../policies/RolePolicy'
import type { DomainEvent } from '../events/DomainEvent'
import { accountRegistered } from '../events/AccountRegistered'
import { accountEmailChanged } from '../events/AccountEmailChanged'
import { accountVerified } from '../events/AccountVerified'

export interface AccountSnapshot {
  readonly id: string
  readonly email: string
  readonly displayName: string
  readonly status: AccountStatus
  readonly roles: readonly Role[]
}

/**
 * Raiz de agregado del contexto Account/Identity.
 *
 * Modela el ciclo de vida de una cuenta y sus roles. No almacena contrasenas
 * ni secretos de autenticacion: la verificacion de credenciales pertenece al
 * proveedor de identidad externo, detras de IdentityProviderPort.
 */
export class Account {
  readonly id: AccountId
  private email: EmailAddress
  private displayName: DisplayName
  private status: AccountStatus
  private readonly roles: Set<Role>
  private readonly events: DomainEvent[] = []

  private constructor(params: {
    id: AccountId
    email: EmailAddress
    displayName: DisplayName
    status: AccountStatus
    roles: Set<Role>
  }) {
    this.id = params.id
    this.email = params.email
    this.displayName = params.displayName
    this.status = params.status
    this.roles = params.roles
  }

  /** Registra una cuenta nueva. Nace pendiente de verificacion. */
  static register(params: {
    id: AccountId
    email: EmailAddress
    displayName: DisplayName
    occurredAt: Date
  }): Account {
    const account = new Account({
      id: params.id,
      email: params.email,
      displayName: params.displayName,
      status: AccountStatus.PendingVerification,
      roles: new Set<Role>([RolePolicy.baseRole]),
    })

    account.events.push(
      accountRegistered({
        aggregateId: params.id.value,
        email: params.email.value,
        displayName: params.displayName.value,
        occurredAt: params.occurredAt,
      }),
    )

    return account
  }

  /** Reconstituye una cuenta ya persistida. No emite eventos. */
  static restore(params: {
    id: AccountId
    email: EmailAddress
    displayName: DisplayName
    status: AccountStatus
    roles: readonly Role[]
  }): Account {
    if (params.roles.length === 0) {
      throw new DomainError('Una cuenta restaurada debe conservar al menos un rol.')
    }

    return new Account({
      id: params.id,
      email: params.email,
      displayName: params.displayName,
      status: params.status,
      roles: new Set<Role>(params.roles),
    })
  }

  get currentEmail(): EmailAddress {
    return this.email
  }

  get currentDisplayName(): DisplayName {
    return this.displayName
  }

  get currentStatus(): AccountStatus {
    return this.status
  }

  get currentRoles(): readonly Role[] {
    return [...this.roles]
  }

  /**
   * Una cuenta solo puede autenticarse cuando esta activa. Una cuenta pendiente
   * de verificacion existe, pero todavia no ha demostrado control del correo.
   */
  get canAuthenticate(): boolean {
    return this.status === AccountStatus.Active
  }

  hasRole(role: Role): boolean {
    return this.roles.has(role)
  }

  verify(occurredAt: Date): void {
    if (this.status === AccountStatus.Suspended) {
      throw new DomainError(`La cuenta ${this.id.value} esta suspendida y no puede verificarse.`)
    }

    if (this.status === AccountStatus.Active) {
      throw new DomainError(`La cuenta ${this.id.value} ya fue verificada.`)
    }

    this.status = AccountStatus.Active
    this.events.push(
      accountVerified({
        aggregateId: this.id.value,
        email: this.email.value,
        occurredAt,
      }),
    )
  }

  suspend(): void {
    if (this.status === AccountStatus.Suspended) {
      throw new DomainError(`La cuenta ${this.id.value} ya esta suspendida.`)
    }

    this.status = AccountStatus.Suspended
  }

  reinstate(): void {
    if (this.status !== AccountStatus.Suspended) {
      throw new DomainError(`La cuenta ${this.id.value} no esta suspendida.`)
    }

    this.status = AccountStatus.Active
  }

  rename(displayName: DisplayName): void {
    this.displayName = displayName
  }

  /**
   * Cambiar el correo invalida la verificacion previa: la nueva direccion
   * todavia no ha demostrado pertenecer a la persona titular.
   */
  changeEmail(email: EmailAddress, occurredAt: Date): boolean {
    if (this.email.equals(email)) {
      return false
    }

    const previous = this.email
    this.email = email
    this.status = AccountStatus.PendingVerification

    this.events.push(
      accountEmailChanged({
        aggregateId: this.id.value,
        previousEmail: previous.value,
        newEmail: email.value,
        occurredAt,
      }),
    )

    return true
  }

  grantRole(role: Role, actorRoles: ReadonlySet<Role>): void {
    if (!RolePolicy.canManageRoles(actorRoles)) {
      throw new DomainError('Solo un administrador puede conceder roles.')
    }

    this.roles.add(role)
  }

  revokeRole(role: Role, actorRoles: ReadonlySet<Role>): void {
    if (!RolePolicy.canManageRoles(actorRoles)) {
      throw new DomainError('Solo un administrador puede retirar roles.')
    }

    if (!RolePolicy.isRemovable(role)) {
      throw new DomainError(`El rol ${role} es el minimo de toda cuenta y no puede retirarse.`)
    }

    this.roles.delete(role)
  }

  pullEvents(): readonly DomainEvent[] {
    const pulled = [...this.events]
    this.events.length = 0

    return pulled
  }

  toSnapshot(): AccountSnapshot {
    return {
      id: this.id.value,
      email: this.email.value,
      displayName: this.displayName.value,
      status: this.status,
      roles: [...this.roles],
    }
  }
}
