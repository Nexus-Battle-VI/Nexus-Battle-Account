import { Account } from '../../domain/entities/Account'
import { AccountId } from '../../domain/value-objects/AccountId'
import { AvatarMetadata, assertAvatarUpload } from '../../domain/value-objects/AvatarMetadata'
import { DisplayName } from '../../domain/value-objects/DisplayName'
import { EmailAddress } from '../../domain/value-objects/EmailAddress'
import { PersonName } from '../../domain/value-objects/PersonName'
import { DomainError } from '../../domain/errors/DomainError'
import type { AccountRepositoryPort, PrivacyConsentRecord } from '../ports/AccountRepositoryPort'
import type { ApplicablePrivacyPolicyPort } from '../ports/ApplicablePrivacyPolicyPort'
import type { AvatarStoragePort } from '../ports/AvatarStoragePort'
import type { ClockPort } from '../ports/ClockPort'
import type { IdGeneratorPort } from '../ports/IdGeneratorPort'
import type { NicknameBlacklistPort } from '../ports/NicknameBlacklistPort'
import type { NotificationRequestPort } from '../ports/NotificationRequestPort'
import type { RoleDirectoryPort } from '../ports/RoleDirectoryPort'
import type { IdentitySignUpPort } from '../ports/IdentitySignUpPort'
import type { SecurityQuestionCatalogPort } from '../ports/SecurityQuestionCatalogPort'
import {
  AccountAlreadyExistsError,
  DisplayNameAlreadyTakenError,
  NicknameBlacklistedError,
} from '../errors/ApplicationError'
import type { RegisterAccountCommand } from '../dto/RegisterAccountCommand'
import { type AccountDto, toAccountDto } from '../dto/AccountDto'
import { hashSecurityAnswer } from '../security/hashSecurityAnswer'

export interface RegisterAccountDependencies {
  readonly accounts: AccountRepositoryPort
  readonly notifications: NotificationRequestPort
  readonly clock: ClockPort
  readonly ids: IdGeneratorPort
  readonly avatars: AvatarStoragePort
  readonly blacklist: NicknameBlacklistPort
  readonly questions: SecurityQuestionCatalogPort
  readonly roleDirectory: RoleDirectoryPort
  readonly identitySignUp: IdentitySignUpPort
  readonly applicablePrivacyPolicy: ApplicablePrivacyPolicyPort
}

/**
 * Registra una cuenta de jugador (HU-01).
 *
 * Coordina colaboradores fuera de PostgreSQL (avatar y directorio de roles) y
 * persiste cuenta, roles y respuestas en un unico paso del repositorio. Si la
 * persistencia falla, se compensa el avatar guardado en esta peticion.
 *
 * LIMITACION conocida: la identidad que crea `signUp` NO se compensa. Un fallo
 * despues del alta -carrera de apodo, el proveedor de roles caido, el avatar sin
 * poder escribirse- deja en Cognito una identidad sin confirmar que bloquea el
 * reintento con ese mismo correo (`SignUp` responderia `emailTaken`). Se acepta
 * a proposito: compensarla exige `AdminDeleteUser`, que reintroduce la API de
 * administracion y su permiso IAM que este alta evita. La ventana se minimiza
 * validando todo lo validable -unicidad, apodo, avatar, respuestas- ANTES de
 * `signUp`. Si se vuelve frecuente, la salida es una identidad huerfana que se
 * pueda reclamar, no abrir el alta a la API de administracion.
 */
export class RegisterAccount {
  private readonly deps: RegisterAccountDependencies

  constructor(deps: RegisterAccountDependencies) {
    this.deps = deps
  }

  async execute(command: RegisterAccountCommand): Promise<AccountDto> {
    const firstNames = PersonName.create(command.firstNames, 'Los nombres')
    const lastNames = PersonName.create(command.lastNames, 'Los apellidos')
    const email = EmailAddress.create(command.email)

    if (await this.deps.accounts.existsByEmail(email)) {
      throw new AccountAlreadyExistsError(email.value)
    }

    // La contrasena vuelve, y esta vez SI va a algun sitio: a Cognito, por
    // `signUp` (ADR-004, "Alta server-side"). Account no la custodia -la
    // decision 2 sigue intacta-, solo la transporta a su unico custodio. Aqui
    // solo se comprueba que exista; la POLITICA la aplica el proveedor, y su
    // rechazo llega como `IdentitySignUpError` -> 400 con el motivo.
    if (command.password.length === 0) {
      throw new DomainError('La contrasena es obligatoria.')
    }

    const displayName = DisplayName.create(command.displayName)

    if (await this.deps.accounts.existsByDisplayName(displayName)) {
      throw new DisplayNameAlreadyTakenError(displayName.value)
    }

    if (await this.deps.blacklist.isBlocked(displayName.value)) {
      throw new NicknameBlacklistedError()
    }

    if (!command.termsAccepted) {
      throw new DomainError('El registro exige aceptar los terminos y condiciones.')
    }

    // EN-011, CA-02: la version que Web presento debe existir y ser
    // reconocida como aplicable HOY (ver `ApplicablePrivacyPolicyPort`). No se
    // acepta cualquier cadena que envie el cliente: Account decide, igual que
    // decide el rol, no confia en lo que llega.
    if (command.privacyPolicyVersion.length === 0) {
      throw new DomainError('El registro exige indicar la version de la Politica aceptada.')
    }

    if (!this.deps.applicablePrivacyPolicy.isApplicable(command.privacyPolicyVersion)) {
      throw new DomainError(
        `La version de Politica "${command.privacyPolicyVersion}" no es la version aplicable.`,
      )
    }

    const hashedAnswers = await this.hashRequiredAnswers(command)
    const avatarUpload = command.avatar

    if (avatarUpload === undefined) {
      throw new DomainError('El avatar es obligatorio.')
    }

    assertAvatarUpload(avatarUpload)

    // Account CREA la identidad en el proveedor y obtiene el sujeto que este
    // asigna. No la decide -Cognito sigue siendo la autoridad: valida el
    // correo, custodia la contrasena, aplica la politica-. Account es el
    // mensajero, igual que ya lo es en el login (ADR-004, "Alta server-side").
    //
    // Ocurre ANTES de guardar el avatar: si el proveedor rechaza el alta -correo
    // ya existente, contrasena debil-, no queda ningun efecto a medias.
    const signUp = await this.deps.identitySignUp.signUp(email.value, command.password)

    if (signUp.kind === 'emailTaken') {
      // El correo ya existe en el proveedor. Mismo trato que si existiera en la
      // base: 409, e invitar a iniciar sesion, no un 500.
      throw new AccountAlreadyExistsError(email.value)
    }

    const subject = signUp.subject

    const accountId = AccountId.create(this.deps.ids.generate())
    let storedKey: string | null = null
    let account: Account
    // Un unico instante para la cuenta y para el consentimiento: son parte del
    // mismo hecho de registro, y leer el reloj dos veces solo introduciria una
    // diferencia de microsegundos sin ningun significado de negocio.
    const registeredAt = this.deps.clock.now()

    try {
      const stored = await this.deps.avatars.store({
        accountId: accountId.value,
        mimeType: avatarUpload.mimeType,
        originalName: avatarUpload.originalName,
        bytes: avatarUpload.bytes,
      })
      storedKey = stored.storageKey

      account = Account.register({
        id: accountId,
        subject,
        email,
        displayName,
        firstNames,
        lastNames,
        termsAccepted: true,
        // Nace PENDING. Cognito acaba de enviar el codigo al correo; la cuenta
        // se activa cuando quien registra lo confirma (`ConfirmRegistration`).
        avatar: AvatarMetadata.create({
          storageKey: stored.storageKey,
          mimeType: avatarUpload.mimeType,
          sizeBytes: stored.sizeBytes,
          originalName: avatarUpload.originalName,
        }),
        occurredAt: registeredAt,
      })

      // El reflejo va ANTES de persistir, y el orden es la decision.
      //
      // Al reves, un fallo aqui dejaria una cuenta guardada cuyo rol no viaja
      // en el testimonio: la divergencia silenciosa que este puerto existe para
      // impedir, y ademas irreparable por reintento, porque el segundo intento
      // chocaria con el correo ya registrado.
      //
      // En este orden, lo peor que puede pasar es que el sujeto quede en el
      // grupo `PLAYER` sin cuenta. Eso no concede nada -toda ruta protegida
      // resuelve la cuenta a partir del sujeto y no la encontraria- y el
      // reintento lo absorbe, porque `reflect` es idempotente.
      await this.deps.roleDirectory.reflect(subject, account.currentRoles)

      const consent: PrivacyConsentRecord = {
        id: this.deps.ids.generate(),
        policyVersion: command.privacyPolicyVersion,
        acceptedAt: registeredAt,
      }

      await this.deps.accounts.saveRegistration(account, hashedAnswers, consent)
    } catch (error: unknown) {
      if (storedKey !== null) {
        await this.deps.avatars.remove(storedKey)
      }

      throw error
    }

    await this.deps.notifications.request({
      notificationId: account.id.value,
      recipient: email.value,
      templateId: 'account-welcome',
      variables: { displayName: displayName.value },
    })

    account.pullEvents()

    return toAccountDto(account.toSnapshot())
  }

  private async hashRequiredAnswers(command: RegisterAccountCommand) {
    const catalog = await this.deps.questions.listActive()
    const required = new Set(catalog.map((question) => question.id))

    if (required.size === 0) {
      throw new DomainError('No hay preguntas de seguridad vigentes para el registro.')
    }

    const seen = new Set<string>()

    for (const entry of command.securityAnswers) {
      if (seen.has(entry.questionId) || !required.has(entry.questionId)) {
        throw new DomainError('Las respuestas de seguridad no coinciden con el catalogo vigente.')
      }

      seen.add(entry.questionId)
    }

    if (seen.size !== required.size) {
      throw new DomainError('El registro exige responder todas las preguntas de seguridad.')
    }

    return command.securityAnswers.map((entry) => ({
      questionId: entry.questionId,
      answerHash: hashSecurityAnswer(entry.answer),
    }))
  }
}
