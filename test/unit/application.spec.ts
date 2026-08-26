import { RegisterAccount } from '../../src/application/use-cases/RegisterAccount'
import { GetAccount } from '../../src/application/use-cases/GetAccount'
import { GetOwnAccount } from '../../src/application/use-cases/GetOwnAccount'
import { VerifyAccount } from '../../src/application/use-cases/VerifyAccount'
import {
  AccountAlreadyExistsError,
  AccountNotFoundError,
} from '../../src/application/errors/ApplicationError'
import type { NotificationRequest } from '../../src/application/ports/NotificationRequestPort'
import type { NotificationRequestPort } from '../../src/application/ports/NotificationRequestPort'
import type { AccountRepositoryPort } from '../../src/application/ports/AccountRepositoryPort'
import { InMemoryAccountRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountRepository'
import { FakeIdentityProvider } from '../../src/adapters/outbound/identity/FakeIdentityProvider'
import { AccountStatus } from '../../src/domain/entities/AccountStatus'
import { Role } from '../../src/domain/entities/Role'
import { DomainError } from '../../src/domain/errors/DomainError'

const FIXED_NOW = new Date('2026-08-21T10:00:00.000Z')

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
}

const buildHarness = (overrides: { accounts?: AccountRepositoryPort } = {}): Harness => {
  const accounts = new InMemoryAccountRepository()
  const identity = new FakeIdentityProvider(sequence('sub'))
  const notifier = new RecordingNotifier()
  const clock = { now: (): Date => FIXED_NOW }
  const ids = { generate: sequence('acc') }
  const repository = overrides.accounts ?? accounts

  return {
    accounts,
    identity,
    notifier,
    registerAccount: new RegisterAccount({
      accounts: repository,
      identityProvider: identity,
      notifications: notifier,
      clock,
      ids,
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

const command = { email: 'jugador@nexus.test', displayName: 'Ana Ramirez' }

describe('RegisterAccount', () => {
  it('registra la cuenta, da de alta la identidad y solicita el correo', async () => {
    const harness = buildHarness()

    const result = await harness.registerAccount.execute(command)

    expect(result).toEqual({
      id: 'acc-1',
      email: 'jugador@nexus.test',
      displayName: 'Ana Ramirez',
      status: AccountStatus.PendingVerification,
      roles: [Role.Player],
    })
    expect(harness.accounts.size).toBe(1)
    expect(harness.identity.size).toBe(1)
    expect(harness.notifier.requested).toEqual([
      {
        notificationId: 'acc-1',
        recipient: 'jugador@nexus.test',
        templateId: 'account-welcome',
        variables: { displayName: 'Ana Ramirez' },
      },
    ])
  })

  it('normaliza el correo y el nombre antes de persistir', async () => {
    const harness = buildHarness()

    const result = await harness.registerAccount.execute({
      email: '  Jugador@NEXUS.test ',
      displayName: '  Ana   Ramirez ',
    })

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

  it('propaga la validacion del dominio ante datos invalidos', async () => {
    const harness = buildHarness()

    await expect(
      harness.registerAccount.execute({ ...command, email: 'no-es-correo' }),
    ).rejects.toBeInstanceOf(DomainError)
    await expect(
      harness.registerAccount.execute({ ...command, displayName: 'Ab' }),
    ).rejects.toBeInstanceOf(DomainError)
    expect(harness.identity.size).toBe(0)
  })

  it('compensa la identidad si falla la persistencia', async () => {
    const failing = new InMemoryAccountRepository()
    jest.spyOn(failing, 'save').mockRejectedValue(new Error('almacen no disponible'))

    const harness = buildHarness({ accounts: failing })

    await expect(harness.registerAccount.execute(command)).rejects.toThrow('almacen no disponible')

    // La identidad se retiro: no queda un sujeto huerfano sin cuenta asociada.
    expect(harness.identity.size).toBe(0)
    expect(await harness.identity.findByEmail(command.email)).toBeNull()
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
    // Se relee del repositorio para confirmar que el cambio quedo persistido y
    // no solo aplicado sobre una instancia en memoria.
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

/**
 * El sujeto es el vinculo interno con el proveedor de identidad. Devolverlo en
 * el cuerpo de un 404 no aporta nada a quien pregunta —ya sabe quien es— y saca
 * del servicio un identificador que no tiene por que salir.
 */
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

  /**
   * `AccountDto` no expone el sujeto, y eso es deliberado: por eso hay que
   * indicarlo al registrar para poder comprobar la lectura por ese camino.
   */
  it('devuelve la cuenta vinculada al sujeto', async () => {
    const harness = buildHarness()
    const created = await harness.registerAccount.execute({ ...command, subject: 'sub-propio' })
    const useCase = new GetOwnAccount(harness.accounts)

    expect(await useCase.execute('sub-propio')).toEqual(created)
  })
})
