import { Account } from '../../domain/entities/Account'
import { AccountId } from '../../domain/value-objects/AccountId'
import { AvatarMetadata, assertAvatarUpload } from '../../domain/value-objects/AvatarMetadata'
import { DisplayName } from '../../domain/value-objects/DisplayName'
import { EmailAddress } from '../../domain/value-objects/EmailAddress'
import { PersonName } from '../../domain/value-objects/PersonName'
import { DomainError } from '../../domain/errors/DomainError'
import { PasswordPolicy } from '../../domain/policies/PasswordPolicy'
import type { AccountRepositoryPort } from '../ports/AccountRepositoryPort'
import type { AvatarStoragePort } from '../ports/AvatarStoragePort'
import type { ClockPort } from '../ports/ClockPort'
import type { IdGeneratorPort } from '../ports/IdGeneratorPort'
import type { NicknameBlacklistPort } from '../ports/NicknameBlacklistPort'
import type { NotificationRequestPort } from '../ports/NotificationRequestPort'
import type { SecurityQuestionCatalogPort } from '../ports/SecurityQuestionCatalogPort'
import {
  AccountAlreadyExistsError,
  DisplayNameAlreadyTakenError,
  IdentityRequiredError,
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
}

/**
 * Registra una cuenta de jugador (HU-01).
 *
 * Coordina colaboradores fuera de PostgreSQL (identidad y avatar) y persiste
 * cuenta, roles y respuestas en un unico paso del repositorio. Si la
 * persistencia falla despues del alta, se compensan solo el avatar y el sujeto
 * creados en esta peticion.
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

    PasswordPolicy.assertValid(command.password)
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

    const hashedAnswers = await this.hashRequiredAnswers(command)
    const avatarUpload = command.avatar

    if (avatarUpload === undefined) {
      throw new DomainError('El avatar es obligatorio.')
    }

    assertAvatarUpload(avatarUpload)

    // La identidad existe ANTES que la cuenta.
    //
    // El alta ocurre en la pantalla del proveedor, de modo que al llegar aqui
    // ya hay un sujeto verificado y lo que falta es la cuenta del producto. Este
    // caso de uso NO crea identidades: hacerlo significaria que Account decide
    // quien existe, que es justo lo que ADR-004 saco de Account.
    const subject = command.subject?.trim() ?? ''

    if (subject.length === 0) {
      throw new IdentityRequiredError()
    }

    const accountId = AccountId.create(this.deps.ids.generate())
    let storedKey: string | null = null
    let account: Account

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
        avatar: AvatarMetadata.create({
          storageKey: stored.storageKey,
          mimeType: avatarUpload.mimeType,
          sizeBytes: stored.sizeBytes,
          originalName: avatarUpload.originalName,
        }),
        occurredAt: this.deps.clock.now(),
      })

      await this.deps.accounts.saveRegistration(account, hashedAnswers)
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
