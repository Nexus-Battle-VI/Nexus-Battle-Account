import { Account } from '../../src/domain/entities/Account'
import { AccountStatus } from '../../src/domain/entities/AccountStatus'
import { Role } from '../../src/domain/entities/Role'
import { AccountId } from '../../src/domain/value-objects/AccountId'
import { AvatarMetadata } from '../../src/domain/value-objects/AvatarMetadata'
import { DisplayName } from '../../src/domain/value-objects/DisplayName'
import { EmailAddress } from '../../src/domain/value-objects/EmailAddress'
import { PersonName } from '../../src/domain/value-objects/PersonName'
import { SECURITY_QUESTION_SEED } from '../../src/adapters/outbound/persistence/security-question-seed'
import type { RegisterAccountCommand } from '../../src/application/dto/RegisterAccountCommand'

export const AT = new Date('2026-08-21T10:00:00.000Z')
export const VALID_PASSWORD = 'Abcdefg1!'
export const AVATAR_BYTES = Buffer.from('png-bytes')

export const FOUR_ANSWERS = SECURITY_QUESTION_SEED.map((question, index) => ({
  questionId: question.id,
  answer: `respuesta-${String(index + 1)}`,
}))

export const defaultAvatarMetadata = (accountId = 'acc-1'): AvatarMetadata =>
  AvatarMetadata.create({
    storageKey: `${accountId}/a.png`,
    mimeType: 'image/png',
    sizeBytes: 12,
    originalName: 'a.png',
  })

export const buildAccount = (
  overrides: {
    id?: string
    email?: string
    subject?: string
    displayName?: string
    emailAlreadyVerified?: boolean
  } = {},
): Account => {
  const id = overrides.id ?? 'acc-1'

  return Account.register({
    id: AccountId.create(id),
    subject: overrides.subject ?? (overrides.id === undefined ? 'sujeto-1' : `sujeto-${id}`),
    email: EmailAddress.create(overrides.email ?? 'jugador@nexus.test'),
    displayName: DisplayName.create(overrides.displayName ?? 'Ana Ramirez'),
    firstNames: PersonName.create('Ana', 'Los nombres'),
    lastNames: PersonName.create('Ramirez', 'Los apellidos'),
    termsAccepted: true,
    avatar: defaultAvatarMetadata(id),
    occurredAt: AT,
    ...(overrides.emailAlreadyVerified === undefined
      ? {}
      : { emailAlreadyVerified: overrides.emailAlreadyVerified }),
  })
}

/**
 * Cuenta ACTIVA reconstituida directamente (`Account.restore`), sin pasar por
 * `RegisterAccount` ni por ningun endpoint publico. Existe para HU-02: el
 * login exige una cuenta que ya supero la verificacion, y los roles
 * `MODERATOR`, `ADMINISTRATOR` y `SUPER_ADMINISTRATOR` no se obtienen a
 * traves de HU-01 (que solo concede `PLAYER`). Un Super Administrador de
 * prueba se construye asi a proposito: no existe una API publica que lo cree
 * (HU-02, tratamiento de HU-10 en el reporte).
 */
export const buildActiveAccount = (
  overrides: {
    id?: string
    email?: string
    subject?: string
    displayName?: string
    roles?: readonly Role[]
  } = {},
): Account => {
  const id = overrides.id ?? 'acc-1'

  return Account.restore({
    id: AccountId.create(id),
    subject: overrides.subject ?? `sujeto-${id}`,
    email: EmailAddress.create(overrides.email ?? 'jugador@nexus.test'),
    displayName: DisplayName.create(overrides.displayName ?? 'Ana Ramirez'),
    firstNames: PersonName.create('Ana', 'Los nombres'),
    lastNames: PersonName.create('Ramirez', 'Los apellidos'),
    termsAccepted: true,
    avatar: defaultAvatarMetadata(id),
    status: AccountStatus.Active,
    roles: overrides.roles ?? [Role.Player],
  })
}

export const validCommand = (
  overrides: Partial<RegisterAccountCommand> = {},
): RegisterAccountCommand => ({
  email: 'jugador@nexus.test',
  password: VALID_PASSWORD,
  displayName: 'Ana Ramirez',
  firstNames: 'Ana',
  lastNames: 'Ramirez',
  termsAccepted: true,
  privacyPolicyVersion: 'v0.3',
  securityAnswers: FOUR_ANSWERS,
  avatar: {
    mimeType: 'image/png',
    originalName: 'a.png',
    sizeBytes: AVATAR_BYTES.length,
    bytes: AVATAR_BYTES,
  },
  ...overrides,
})
