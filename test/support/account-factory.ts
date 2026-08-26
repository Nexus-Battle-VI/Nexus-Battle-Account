import { Account } from '../../src/domain/entities/Account'
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
  securityAnswers: FOUR_ANSWERS,
  avatar: {
    mimeType: 'image/png',
    originalName: 'a.png',
    sizeBytes: AVATAR_BYTES.length,
    bytes: AVATAR_BYTES,
  },
  ...overrides,
})
