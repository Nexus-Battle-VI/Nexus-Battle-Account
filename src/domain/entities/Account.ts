import { DomainError } from '../errors/DomainError'
import type { AccountId } from '../value-objects/AccountId'
import { EmailAddress } from '../value-objects/EmailAddress'
import { DisplayName } from '../value-objects/DisplayName'
import { PersonName } from '../value-objects/PersonName'
import { AvatarMetadata } from '../value-objects/AvatarMetadata'
import { AccountStatus } from './AccountStatus'
import type { Role } from './Role'
import { RolePolicy } from '../policies/RolePolicy'
import type { DomainEvent } from '../events/DomainEvent'
import { accountRegistered } from '../events/AccountRegistered'
import { accountEmailChanged } from '../events/AccountEmailChanged'
import { accountVerified } from '../events/AccountVerified'

export interface AccountSnapshot {
  readonly id: string
  /** Sujeto de la cuenta en el proveedor de identidad. Vease ADR-004. */
  readonly subject: string
  readonly email: string
  readonly displayName: string
  readonly firstNames: string
  readonly lastNames: string
  readonly termsAccepted: boolean
  readonly avatarStorageKey: string
  readonly avatarMimeType: string
  readonly avatarSizeBytes: number
  readonly avatarOriginalName: string
  readonly status: AccountStatus
  readonly roles: readonly Role[]
}

/**
 * Raiz de agregado del contexto Account/Identity.
 *
 * Modela el ciclo de vida de una cuenta y sus roles. No almacena contrasenas
 * ni secretos de autenticacion: la verificacion de credenciales pertenece al
 * proveedor de identidad externo. La identidad existe ANTES que la cuenta:
 * Account no la crea, la recibe ya verificada.
 */
export class Account {
  readonly id: AccountId

  /**
   * Identificador de esta cuenta en el proveedor de identidad.
   *
   * Es lo que permite responder a la pregunta "esta cuenta es de quien la
   * pide". Sin el, un testimonio valido servia para leer CUALQUIER cuenta,
   * porque no habia forma de relacionar el `sub` del token con un agregado.
   *
   * Es inmutable: el correo puede cambiar y el nombre visible tambien, pero el
   * sujeto es lo unico estable a lo largo de la vida de la cuenta. Por eso el
   * vinculo se hace contra el, y no contra el correo.
   */
  readonly subject: string

  private email: EmailAddress
  private displayName: DisplayName
  private firstNames: PersonName
  private lastNames: PersonName
  private readonly termsAccepted: boolean
  private avatar: AvatarMetadata
  private status: AccountStatus
  private readonly roles: Set<Role>
  private readonly events: DomainEvent[] = []

  private constructor(params: {
    id: AccountId
    subject: string
    email: EmailAddress
    displayName: DisplayName
    firstNames: PersonName
    lastNames: PersonName
    termsAccepted: boolean
    avatar: AvatarMetadata
    status: AccountStatus
    roles: Set<Role>
  }) {
    this.id = params.id
    this.subject = params.subject
    this.email = params.email
    this.displayName = params.displayName
    this.firstNames = params.firstNames
    this.lastNames = params.lastNames
    this.termsAccepted = params.termsAccepted
    this.avatar = params.avatar
    this.status = params.status
    this.roles = params.roles
  }

  /**
   * Registra una cuenta nueva.
   *
   * Nace pendiente de verificacion, SALVO que el proveedor ya haya declarado
   * verificado ese mismo correo. `PENDING_VERIFICATION` espera la prueba de que
   * alguien controla el buzon, y esa prueba es justo la que el proveedor
   * entrega en el testimonio.
   */
  static register(params: {
    id: AccountId
    subject: string
    email: EmailAddress
    displayName: DisplayName
    firstNames: PersonName
    lastNames: PersonName
    termsAccepted: boolean
    avatar: AvatarMetadata
    occurredAt: Date
    /** El proveedor declara verificado ESTE correo, no otro. */
    emailAlreadyVerified?: boolean
  }): Account {
    if (params.subject.trim().length === 0) {
      throw new DomainError('Una cuenta debe quedar vinculada a un sujeto de identidad.')
    }

    if (!params.termsAccepted) {
      throw new DomainError('El registro exige aceptar los terminos y condiciones.')
    }

    const account = new Account({
      id: params.id,
      subject: params.subject,
      email: params.email,
      displayName: params.displayName,
      firstNames: params.firstNames,
      lastNames: params.lastNames,
      termsAccepted: true,
      avatar: params.avatar,
      status:
        params.emailAlreadyVerified === true
          ? AccountStatus.Active
          : AccountStatus.PendingVerification,
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
    subject: string
    email: EmailAddress
    displayName: DisplayName
    firstNames: PersonName
    lastNames: PersonName
    termsAccepted: boolean
    avatar: AvatarMetadata
    status: AccountStatus
    roles: readonly Role[]
  }): Account {
    if (params.roles.length === 0) {
      throw new DomainError('Una cuenta restaurada debe conservar al menos un rol.')
    }

    if (params.subject.trim().length === 0) {
      throw new DomainError('Una cuenta restaurada debe conservar su sujeto de identidad.')
    }

    return new Account({
      id: params.id,
      subject: params.subject,
      email: params.email,
      displayName: params.displayName,
      firstNames: params.firstNames,
      lastNames: params.lastNames,
      termsAccepted: params.termsAccepted,
      avatar: params.avatar,
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

  get currentFirstNames(): PersonName {
    return this.firstNames
  }

  get currentLastNames(): PersonName {
    return this.lastNames
  }

  get acceptedTerms(): boolean {
    return this.termsAccepted
  }

  get currentAvatar(): AvatarMetadata {
    return this.avatar
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

  get isDeleted(): boolean {
    return this.status === AccountStatus.Deleted
  }

  hasRole(role: Role): boolean {
    return this.roles.has(role)
  }

  /**
   * Una cuenta eliminada (HU-43.3) es terminal: ninguna otra transicion del
   * ciclo de vida admite reabrirla, reasignarla ni reactivarla.
   */
  private ensureNotDeleted(action: string): void {
    if (this.status === AccountStatus.Deleted) {
      throw new DomainError(`La cuenta ${this.id.value} fue eliminada y no admite ${action}.`)
    }
  }

  verify(occurredAt: Date): void {
    this.ensureNotDeleted('verificarse')

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
    this.ensureNotDeleted('suspenderse')

    if (this.status === AccountStatus.Suspended) {
      throw new DomainError(`La cuenta ${this.id.value} ya esta suspendida.`)
    }

    this.status = AccountStatus.Suspended
  }

  reinstate(): void {
    this.ensureNotDeleted('reinstalarse')

    if (this.status !== AccountStatus.Suspended) {
      throw new DomainError(`La cuenta ${this.id.value} no esta suspendida.`)
    }

    this.status = AccountStatus.Active
  }

  rename(displayName: DisplayName): void {
    this.ensureNotDeleted('cambiar de apodo')

    this.displayName = displayName
  }

  /**
   * Cambiar el correo invalida la verificacion previa: la nueva direccion
   * todavia no ha demostrado pertenecer a la persona titular.
   */
  changeEmail(email: EmailAddress, occurredAt: Date): boolean {
    this.ensureNotDeleted('cambiar de correo')

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
    this.ensureNotDeleted('recibir roles')

    if (!RolePolicy.canManageRoles(actorRoles)) {
      throw new DomainError('Solo un Super Administrador puede conceder roles.')
    }

    this.roles.add(role)
  }

  revokeRole(role: Role, actorRoles: ReadonlySet<Role>): void {
    this.ensureNotDeleted('retirar roles')

    if (!RolePolicy.canManageRoles(actorRoles)) {
      throw new DomainError('Solo un Super Administrador puede retirar roles.')
    }

    if (!RolePolicy.isRemovable(role)) {
      throw new DomainError(`El rol ${role} es el minimo de toda cuenta y no puede retirarse.`)
    }

    this.roles.delete(role)
  }

  /**
   * Tratamiento de HU-43.3 sobre los datos propios de Account.
   *
   * La matriz de tratamiento (Infrastructure,
   * docs/privacy/data-treatment-matrix-v0.3.md) clasifica nombres, apellidos,
   * apodo y avatar como eliminables SIN excepcion cuando la cuenta se
   * elimina: se sobrescriben con un valor anonimizado y unico por cuenta
   * -nunca se deja el campo vacio, porque `EmailAddress`, `DisplayName` y
   * `PersonName` siguen exigiendo un valor que cumpla su propio formato-.
   *
   * NO toca: la contrasena (Cognito, fuera del alcance de HU-43 sobre datos
   * propios, segun la misma matriz), `termsAccepted` (la matriz lo deja
   * "Pendiente decision", no se inventa una regla), ni los roles (retirarlos
   * violaria el invariante de `restore` -toda cuenta reconstituida exige al
   * menos un rol- sin que la matriz exija vaciarlos: una cuenta eliminada ya
   * no puede autenticarse, con o sin roles).
   *
   * Idempotente: procesar una cuenta ya eliminada no hace nada. Es lo que
   * permite que HU-43.3 reintente el tratamiento completo tras un reinicio
   * sin depender de progreso en memoria.
   */
  erase(): void {
    if (this.status === AccountStatus.Deleted) {
      return
    }

    this.email = EmailAddress.create(`${this.id.value}@eliminado.invalid`)
    this.displayName = DisplayName.create(`Eliminada-${this.id.value.slice(0, 8)}`)
    this.firstNames = PersonName.create('Eliminado', 'Los nombres')
    this.lastNames = PersonName.create('Eliminado', 'Los apellidos')
    this.avatar = AvatarMetadata.create({
      storageKey: `eliminado/${this.id.value}`,
      mimeType: 'image/gif',
      sizeBytes: 1,
      originalName: 'eliminado',
    })
    this.status = AccountStatus.Deleted
  }

  pullEvents(): readonly DomainEvent[] {
    const pulled = [...this.events]
    this.events.length = 0

    return pulled
  }

  toSnapshot(): AccountSnapshot {
    return {
      id: this.id.value,
      subject: this.subject,
      email: this.email.value,
      displayName: this.displayName.value,
      firstNames: this.firstNames.value,
      lastNames: this.lastNames.value,
      termsAccepted: this.termsAccepted,
      avatarStorageKey: this.avatar.storageKey,
      avatarMimeType: this.avatar.mimeType,
      avatarSizeBytes: this.avatar.sizeBytes,
      avatarOriginalName: this.avatar.originalName,
      status: this.status,
      roles: [...this.roles],
    }
  }
}
