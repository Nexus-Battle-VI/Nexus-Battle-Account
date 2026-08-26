import { RegisterAccount } from '../../src/application/use-cases/RegisterAccount'
import { GetAccount } from '../../src/application/use-cases/GetAccount'
import { GetOwnAccount } from '../../src/application/use-cases/GetOwnAccount'
import { VerifyAccount } from '../../src/application/use-cases/VerifyAccount'
import {
  AccountAlreadyExistsError,
  AccountNotFoundError,
  DisplayNameAlreadyTakenError,
  NicknameBlacklistedError,
} from '../../src/application/errors/ApplicationError'
import type { NotificationRequest } from '../../src/application/ports/NotificationRequestPort'
import type { NotificationRequestPort } from '../../src/application/ports/NotificationRequestPort'
import type { AccountRepositoryPort } from '../../src/application/ports/AccountRepositoryPort'
import { InMemoryAccountRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountRepository'
import { InMemoryNicknameBlacklist } from '../../src/adapters/outbound/persistence/InMemoryNicknameBlacklist'
import { InMemorySecurityQuestionCatalog } from '../../src/adapters/outbound/persistence/InMemorySecurityQuestionCatalog'
import { FakeIdentityProvider } from '../../src/adapters/outbound/identity/FakeIdentityProvider'
import { InMemoryAvatarStorage } from '../../src/adapters/outbound/storage/InMemoryAvatarStorage'
import { AccountStatus } from '../../src/domain/entities/AccountStatus'
import { Role } from '../../src/domain/entities/Role'
import { DomainError } from '../../src/domain/errors/DomainError'
import { EmailAddress } from '../../src/domain/value-objects/EmailAddress'
import { AVATAR_MAX_BYTES } from '../../src/domain/value-objects/AvatarMetadata'
import { hashSecurityAnswer } from '../../src/application/security/hashSecurityAnswer'
import { AT, FOUR_ANSWERS, validCommand } from '../support/account-factory'

class RecordingNotifier implements NotificationRequestPort {
  readonly requested: NotificationRequest[] = []

  request(notification: NotificationRequest): Promise<void> {
    this.requested.push(notification)

    return Promise.resolve()
  }
}

interface Harness {
  registerAccount: RegisterAccount
  getAccount: GetAccount
  verifyAccount: VerifyAccount
  accounts: InMemoryAccountRepository
  identity: FakeIdentityProvider
  notifier: RecordingNotifier
  avatars: InMemoryAvatarStorage
  blacklist: InMemoryNicknameBlacklist
}

const buildHarness = (overrides: { accounts?: AccountRepositoryPort } = {}): Harness => {
  const accounts = new InMemoryAccountRepository()
  const identity = new FakeIdentityProvider(sequence('sub'))
  const notifier = new RecordingNotifier()
  const avatars = new InMemoryAvatarStorage()
  const blacklist = new InMemoryNicknameBlacklist()
  const clock = { now: (): Date => AT }
  const ids = { generate: sequence('acc') }
  const repository = overrides.accounts ?? accounts

  return {
    accounts,
    identity,
    notifier,
    avatars,
    blacklist,
    registerAccount: new RegisterAccount({
      accounts: repository,
      identityProvider: identity,
      notifications: notifier,
      clock,
      ids,
      avatars,
      blacklist,
      questions: new InMemorySecurityQuestionCatalog(),
    }),
    getAccount: new GetAccount(repository),
    verifyAccount: new VerifyAccount({ accounts: repository, clock }),
  }
}

function sequence(prefix: string): () => string {
  let counter = 0

  return (): string => {
    counter += 1

    return `${prefix}-${String(counter)}`
  }
}

const command = validCommand()

describe('RegisterAccount', () => {
  it('registra la cuenta, da de alta la identidad y solicita el correo', async () => {
    const harness = buildHarness()

    const result = await harness.registerAccount.execute(command)

    expect(result).toEqual({
      id: 'acc-1',
      email: 'jugador@nexus.test',
      displayName: 'Ana Ramirez',
      firstNames: 'Ana',
      lastNames: 'Ramirez',
      status: AccountStatus.PendingVerification,
      roles: [Role.Player],
    })
    expect(harness.accounts.size).toBe(1)
    expect(harness.identity.size).toBe(1)
    expect(harness.avatars.size).toBe(1)
    expect(harness.notifier.requested).toEqual([
      {
        notificationId: 'acc-1',
        recipient: 'jugador@nexus.test',
        templateId: 'account-welcome',
        variables: { displayName: 'Ana Ramirez' },
      },
    ])
  })

  it('asigna el rol PLAYER y no persiste la contrasena', async () => {
    const harness = buildHarness()
    await harness.registerAccount.execute(command)

    const stored = await harness.accounts.findByEmail(EmailAddress.create(command.email))

    expect(stored?.currentRoles).toEqual([Role.Player])
    expect(JSON.stringify(stored?.toSnapshot())).not.toContain(command.password)
  })

  it('guarda el hash de las respuestas, no el texto en claro', async () => {
    const harness = buildHarness()
    await harness.registerAccount.execute(command)

    const stored = harness.accounts.answersOf('acc-1')

    expect(stored).toHaveLength(4)
    for (const [index, answer] of FOUR_ANSWERS.entries()) {
      expect(stored[index]?.answerHash).toBe(hashSecurityAnswer(answer.answer))
      expect(stored[index]?.answerHash).not.toContain(answer.answer)
    }
  })

  it('normaliza el correo y el nombre antes de persistir', async () => {
    const harness = buildHarness()

    const result = await harness.registerAccount.execute(
      validCommand({
        email: '  Jugador@NEXUS.test ',
        displayName: '  Ana   Ramirez ',
      }),
    )

    expect(result.email).toBe('jugador@nexus.test')
    expect(result.displayName).toBe('Ana Ramirez')
  })

  it('rechaza un correo ya registrado sin tocar el proveedor de identidad', async () => {
    const harness = buildHarness()
    await harness.registerAccount.execute(command)

    await expect(harness.registerAccount.execute(command)).rejects.toBeInstanceOf(
      AccountAlreadyExistsError,
    )
    expect(harness.identity.size).toBe(1)
    expect(harness.accounts.size).toBe(1)
  })

  it('rechaza un apodo duplicado sin distinguir mayusculas', async () => {
    const harness = buildHarness()
    await harness.registerAccount.execute(command)

    await expect(
      harness.registerAccount.execute(
        validCommand({ email: 'otra@nexus.test', displayName: 'ANA RAMIREZ' }),
      ),
    ).rejects.toBeInstanceOf(DisplayNameAlreadyTakenError)
  })

  it('rechaza un apodo presente en la lista negra activa', async () => {
    const harness = buildHarness()
    harness.blacklist.add('ramirez', true)

    await expect(harness.registerAccount.execute(command)).rejects.toBeInstanceOf(
      NicknameBlacklistedError,
    )
    expect(harness.identity.size).toBe(0)
  })

  it('un termino inactivo no bloquea el apodo', async () => {
    const harness = buildHarness()
    harness.blacklist.add('ramirez', false)

    await expect(harness.registerAccount.execute(command)).resolves.toMatchObject({
      displayName: 'Ana Ramirez',
    })
  })

  it('propaga la validacion del dominio ante datos invalidos', async () => {
    const harness = buildHarness()

    await expect(
      harness.registerAccount.execute(validCommand({ email: 'no-es-correo' })),
    ).rejects.toBeInstanceOf(DomainError)
    await expect(
      harness.registerAccount.execute(validCommand({ displayName: 'Ab' })),
    ).rejects.toBeInstanceOf(DomainError)
    await expect(
      harness.registerAccount.execute(validCommand({ firstNames: '  ' })),
    ).rejects.toBeInstanceOf(DomainError)
    await expect(
      harness.registerAccount.execute(validCommand({ lastNames: '' })),
    ).rejects.toBeInstanceOf(DomainError)
    expect(harness.identity.size).toBe(0)
  })

  it('rechaza contrasenas que no cumplen la politica', async () => {
    const harness = buildHarness()

    await expect(
      harness.registerAccount.execute(validCommand({ password: 'Abcde1!x' })),
    ).rejects.toThrow(/mas de 8/)
    await expect(
      harness.registerAccount.execute(validCommand({ password: 'abcdefg1!' })),
    ).rejects.toThrow(/mayuscula/)
    await expect(
      harness.registerAccount.execute(validCommand({ password: 'ABCDEFG1!' })),
    ).rejects.toThrow(/minuscula/)
    await expect(
      harness.registerAccount.execute(validCommand({ password: 'Abcdefgh!' })),
    ).rejects.toThrow(/numero/)
    await expect(
      harness.registerAccount.execute(validCommand({ password: 'Abcdefg12' })),
    ).rejects.toThrow(/simbolo/)
  })

  it('rechaza un apodo de mas de 32 caracteres', async () => {
    const harness = buildHarness()

    await expect(
      harness.registerAccount.execute(validCommand({ displayName: 'x'.repeat(33) })),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('rechaza termsAccepted distinto de true', async () => {
    const harness = buildHarness()

    await expect(
      harness.registerAccount.execute(validCommand({ termsAccepted: false })),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('rechaza avatar ausente, no imagen o demasiado grande', async () => {
    const harness = buildHarness()

    await expect(
      harness.registerAccount.execute(validCommand({ avatar: undefined })),
    ).rejects.toThrow(/avatar es obligatorio/)
    await expect(
      harness.registerAccount.execute(
        validCommand({
          avatar: {
            mimeType: 'application/pdf',
            originalName: 'a.pdf',
            sizeBytes: 10,
            bytes: Buffer.from('pdf'),
          },
        }),
      ),
    ).rejects.toThrow(/image/)
    await expect(
      harness.registerAccount.execute(
        validCommand({
          avatar: {
            mimeType: 'image/png',
            originalName: 'a.png',
            sizeBytes: AVATAR_MAX_BYTES + 1,
            bytes: Buffer.from('x'),
          },
        }),
      ),
    ).rejects.toThrow(/no puede superar/)
  })

  it('rechaza cuando falta una respuesta de seguridad', async () => {
    const harness = buildHarness()

    await expect(
      harness.registerAccount.execute(validCommand({ securityAnswers: FOUR_ANSWERS.slice(0, 3) })),
    ).rejects.toThrow(/todas las preguntas/)
  })

  it('acepta las cuatro respuestas validas', async () => {
    const harness = buildHarness()

    await expect(harness.registerAccount.execute(command)).resolves.toMatchObject({
      email: 'jugador@nexus.test',
    })
  })

  it('compensa identidad y avatar si falla la persistencia', async () => {
    const failing = new InMemoryAccountRepository()
    jest.spyOn(failing, 'saveRegistration').mockRejectedValue(new Error('almacen no disponible'))

    const harness = buildHarness({ accounts: failing })

    await expect(harness.registerAccount.execute(command)).rejects.toThrow('almacen no disponible')

    expect(harness.identity.size).toBe(0)
    expect(await harness.identity.findByEmail(command.email)).toBeNull()
    expect(harness.avatars.size).toBe(0)
  })
})

describe('GetAccount', () => {
  it('recupera una cuenta existente', async () => {
    const harness = buildHarness()
    const created = await harness.registerAccount.execute(command)

    expect(await harness.getAccount.execute(created.id)).toEqual(created)
  })

  it('falla cuando la cuenta no existe', async () => {
    const harness = buildHarness()

    await expect(harness.getAccount.execute('acc-desconocida')).rejects.toBeInstanceOf(
      AccountNotFoundError,
    )
  })

  it('rechaza un identificador vacio', async () => {
    const harness = buildHarness()

    await expect(harness.getAccount.execute('   ')).rejects.toBeInstanceOf(DomainError)
  })
})

describe('VerifyAccount', () => {
  it('activa la cuenta y la persiste', async () => {
    const harness = buildHarness()
    const created = await harness.registerAccount.execute(command)

    const verified = await harness.verifyAccount.execute(created.id)

    expect(verified.status).toBe(AccountStatus.Active)
    expect((await harness.getAccount.execute(created.id)).status).toBe(AccountStatus.Active)
  })

  it('falla cuando la cuenta no existe', async () => {
    const harness = buildHarness()

    await expect(harness.verifyAccount.execute('acc-desconocida')).rejects.toBeInstanceOf(
      AccountNotFoundError,
    )
  })

  it('rechaza verificar dos veces', async () => {
    const harness = buildHarness()
    const created = await harness.registerAccount.execute(command)
    await harness.verifyAccount.execute(created.id)

    await expect(harness.verifyAccount.execute(created.id)).rejects.toBeInstanceOf(DomainError)
  })
})

describe('GetOwnAccount', () => {
  const buildUseCase = (): GetOwnAccount => new GetOwnAccount(new InMemoryAccountRepository())

  it('falla cuando el testimonio no tiene cuenta asociada', async () => {
    await expect(buildUseCase().execute('sub-sin-cuenta')).rejects.toBeInstanceOf(
      AccountNotFoundError,
    )
  })

  it('no incluye el sujeto en el mensaje, pero lo conserva para el registro', async () => {
    await expect(buildUseCase().execute('sub-secreto')).rejects.toMatchObject({
      message: expect.not.stringContaining('sub-secreto'),
      reference: 'sub-secreto',
    })
  })

  it('devuelve la cuenta vinculada al sujeto', async () => {
    const harness = buildHarness()
    const created = await harness.registerAccount.execute(
      validCommand({ ...command, subject: 'sub-propio' }),
    )
    const useCase = new GetOwnAccount(harness.accounts)

    expect(await useCase.execute('sub-propio')).toEqual(created)
  })
})
