import { RegisterAccount } from '../../src/application/use-cases/RegisterAccount'
import { GetAccount } from '../../src/application/use-cases/GetAccount'
import { GetOwnAccount } from '../../src/application/use-cases/GetOwnAccount'
import { VerifyAccount } from '../../src/application/use-cases/VerifyAccount'
import { LoginAccount } from '../../src/application/use-cases/LoginAccount'
import { CompleteSecondFactor } from '../../src/application/use-cases/CompleteSecondFactor'
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
import { InMemoryMfaEvidenceRepository } from '../../src/adapters/outbound/persistence/InMemoryMfaEvidenceRepository'
import type { MfaEvidenceRepositoryPort } from '../../src/application/ports/MfaEvidenceRepositoryPort'
import type {
  TokenVerifierPort,
  VerifiedIdentity,
} from '../../src/application/ports/TokenVerifierPort'
import type { LoginOutcome } from '../../src/application/dto/LoginResult'
import { InMemoryNicknameBlacklist } from '../../src/adapters/outbound/persistence/InMemoryNicknameBlacklist'
import { InMemorySecurityQuestionCatalog } from '../../src/adapters/outbound/persistence/InMemorySecurityQuestionCatalog'
import { FakeAuthenticationProvider } from '../../src/adapters/outbound/identity/FakeAuthenticationProvider'
import { InMemoryRoleDirectory } from '../../src/adapters/outbound/identity/InMemoryRoleDirectory'
import { InMemoryIdentitySignUp } from '../../src/adapters/outbound/identity/InMemoryIdentitySignUp'
import {
  IdentitySignUpError,
  type IdentitySignUpPort,
} from '../../src/application/ports/IdentitySignUpPort'
import {
  RoleDirectoryError,
  type RoleDirectoryPort,
} from '../../src/application/ports/RoleDirectoryPort'
import {
  AuthenticationProviderError,
  SecondFactorMethod,
} from '../../src/application/ports/AuthenticationProviderPort'
import { InMemoryAvatarStorage } from '../../src/adapters/outbound/storage/InMemoryAvatarStorage'
import { AccountStatus } from '../../src/domain/entities/AccountStatus'
import { Role } from '../../src/domain/entities/Role'
import { DomainError } from '../../src/domain/errors/DomainError'
import { EmailAddress } from '../../src/domain/value-objects/EmailAddress'
import { AVATAR_MAX_BYTES } from '../../src/domain/value-objects/AvatarMetadata'
import { hashSecurityAnswer } from '../../src/application/security/hashSecurityAnswer'
import {
  AT,
  FOUR_ANSWERS,
  VALID_PASSWORD,
  buildAccount,
  buildActiveAccount,
  validCommand,
} from '../support/account-factory'

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
  notifier: RecordingNotifier
  avatars: InMemoryAvatarStorage
  blacklist: InMemoryNicknameBlacklist
  roleDirectory: InMemoryRoleDirectory
  identitySignUp: InMemoryIdentitySignUp
}

const buildHarness = (
  overrides: {
    accounts?: AccountRepositoryPort
    roleDirectory?: RoleDirectoryPort
    identitySignUp?: IdentitySignUpPort
  } = {},
): Harness => {
  const accounts = new InMemoryAccountRepository()
  const notifier = new RecordingNotifier()
  const avatars = new InMemoryAvatarStorage()
  const blacklist = new InMemoryNicknameBlacklist()
  const roleDirectory = new InMemoryRoleDirectory()
  const identitySignUp = new InMemoryIdentitySignUp()
  const clock = { now: (): Date => AT }
  const ids = { generate: sequence('acc') }
  const repository = overrides.accounts ?? accounts

  return {
    accounts,
    notifier,
    avatars,
    blacklist,
    roleDirectory,
    identitySignUp,
    registerAccount: new RegisterAccount({
      accounts: repository,
      notifications: notifier,
      clock,
      ids,
      avatars,
      blacklist,
      questions: new InMemorySecurityQuestionCatalog(),
      roleDirectory: overrides.roleDirectory ?? roleDirectory,
      identitySignUp: overrides.identitySignUp ?? identitySignUp,
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
  it('registra la cuenta, refleja el rol y solicita el correo', async () => {
    const harness = buildHarness()

    const result = await harness.registerAccount.execute(command)

    expect(result).toEqual({
      id: 'acc-1',
      email: 'jugador@nexus.test',
      displayName: 'Ana Ramirez',
      countryCode: null,
      firstNames: 'Ana',
      lastNames: 'Ramirez',
      status: AccountStatus.PendingVerification,
      roles: [Role.Player],
    })
    expect(harness.accounts.size).toBe(1)
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

  it('rechaza un segundo registro con el mismo correo, y no como 500', async () => {
    const harness = buildHarness()
    await harness.registerAccount.execute(command)

    // Mismo correo, apodo distinto: choca por el correo, que es unico. Debe ser
    // un 409 con mensaje, no la restriccion de la base reventando sin traducir.
    await expect(
      harness.registerAccount.execute(validCommand({ displayName: 'OtroApodo' })),
    ).rejects.toBeInstanceOf(AccountAlreadyExistsError)
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

  /**
   * Nace PENDING: Cognito acaba de enviar el codigo y el correo aun no esta
   * confirmado. La activacion la hace `ConfirmRegistration`, con su propia
   * suite. Antes este caso de uso "adivinaba" el estado consultando el correo
   * verificado; ahora controla el alta y sabe que esta pendiente.
   */
  it('nace PENDING_VERIFICATION: el correo aun no esta confirmado', async () => {
    const harness = buildHarness()

    const result = await harness.registerAccount.execute(command)

    expect(result.status).toBe(AccountStatus.PendingVerification)
  })

  /**
   * El alta empieza por crear la identidad. Si el proveedor la rechaza -caido,
   * contrasena debil-, NO debe quedar ni cuenta, ni avatar, ni rol reflejado.
   * El fallo llega antes de tocar nada de eso.
   */
  it('no crea nada cuando el proveedor rechaza el alta', async () => {
    const providerDown: IdentitySignUpPort = {
      signUp: () => Promise.reject(new IdentitySignUpError('el proveedor no responde')),
      confirmSignUp: () => Promise.reject(new Error('no deberia llamarse')),
    }
    const harness = buildHarness({ identitySignUp: providerDown })

    await expect(harness.registerAccount.execute(command)).rejects.toBeInstanceOf(
      IdentitySignUpError,
    )

    expect(harness.accounts.size).toBe(0)
    expect(harness.avatars.size).toBe(0)
    expect(harness.notifier.requested).toEqual([])
  })

  it('rechaza un correo ya registrado sin tocar el proveedor de identidad', async () => {
    const harness = buildHarness()
    await harness.registerAccount.execute(command)

    await expect(harness.registerAccount.execute(command)).rejects.toBeInstanceOf(
      AccountAlreadyExistsError,
    )
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
  })

  it('rechaza registrar sin contrasena, y no crea nada', async () => {
    const harness = buildHarness()
    const sinContrasena = { ...validCommand(), password: '' }

    await expect(harness.registerAccount.execute(sinContrasena)).rejects.toBeInstanceOf(DomainError)
    expect(harness.accounts.size).toBe(0)
  })

  it('rechaza un apodo que contiene un termino de la semilla vigente', async () => {
    const harness = buildHarness()

    await expect(
      harness.registerAccount.execute(validCommand({ displayName: 'GonorreaKing' })),
    ).rejects.toBeInstanceOf(NicknameBlacklistedError)
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
  })

  /**
   * La contrasena vuelve al alta y esta vez SI va a algun sitio: a Cognito, por
   * `signUp`. Este servicio la transporta y no la persiste. Se afirma que NO
   * aparece en la instantanea guardada.
   */
  it('transporta la contrasena al proveedor y no la persiste', async () => {
    const harness = buildHarness()
    await harness.registerAccount.execute(command)

    const stored = await harness.accounts.findByEmail(EmailAddress.create(command.email))

    expect(JSON.stringify(stored?.toSnapshot())).not.toContain(command.password)
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

  it('compensa el avatar si falla la persistencia', async () => {
    const failing = new InMemoryAccountRepository()
    jest.spyOn(failing, 'saveRegistration').mockRejectedValue(new Error('almacen no disponible'))

    const harness = buildHarness({ accounts: failing })

    await expect(harness.registerAccount.execute(command)).rejects.toThrow('almacen no disponible')

    expect(harness.avatars.size).toBe(0)
  })

  it('refleja el rol base en el directorio, no solo en la cuenta', async () => {
    const harness = buildHarness()

    const created = await harness.registerAccount.execute(command)

    expect(created.roles).toEqual([Role.Player])
    // El rol tambien esta donde el testimonio lo recoge. El sujeto lo asigno el
    // proveedor (el doble), asi que se lee de la cuenta, no del comando.
    const stored = await harness.accounts.findByEmail(EmailAddress.create(command.email))
    expect(harness.roleDirectory.rolesOf(stored!.subject)).toEqual([Role.Player])
  })

  /**
   * El orden es la decision de diseno, y esta es la prueba que lo fija.
   *
   * Si el reflejo ocurriera despues de persistir, un fallo aqui dejaria una
   * cuenta guardada cuyo rol no viaja en el testimonio, e irreparable por
   * reintento: el segundo intento chocaria con el correo ya registrado.
   */
  it('no guarda la cuenta si el rol no se pudo reflejar', async () => {
    const directorioCaido: RoleDirectoryPort = {
      reflect: () => Promise.reject(new RoleDirectoryError('el proveedor no responde')),
    }

    const harness = buildHarness({ roleDirectory: directorioCaido })

    await expect(harness.registerAccount.execute(command)).rejects.toBeInstanceOf(
      RoleDirectoryError,
    )

    expect(harness.accounts.size).toBe(0)
    expect(harness.avatars.size).toBe(0)
    expect(harness.notifier.requested).toEqual([])
  })

  it('reflejar dos veces deja el mismo resultado que reflejar una', async () => {
    const directorio = new InMemoryRoleDirectory()

    await directorio.reflect('sujeto-ana', [Role.Player])
    await directorio.reflect('sujeto-ana', [Role.Player])

    expect(directorio.rolesOf('sujeto-ana')).toEqual([Role.Player])
  })

  it('el reflejo sustituye la pertenencia, no la acumula', async () => {
    const directorio = new InMemoryRoleDirectory()

    await directorio.reflect('sujeto-ana', [Role.Player, Role.Moderator])
    await directorio.reflect('sujeto-ana', [Role.Player])

    // Un reflejo que solo suma no es un reflejo: retirar un rol en Account
    // nunca llegaria al testimonio y este seguiria concediendolo.
    expect(directorio.rolesOf('sujeto-ana')).toEqual([Role.Player])
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
    const created = await harness.registerAccount.execute(command)
    const stored = await harness.accounts.findByEmail(EmailAddress.create(command.email))
    const useCase = new GetOwnAccount(harness.accounts)

    expect(await useCase.execute(stored!.subject)).toEqual(created)
  })
})

interface LoginHarness {
  accounts: InMemoryAccountRepository
  authProvider: FakeAuthenticationProvider
  mfaEvidence: InMemoryMfaEvidenceRepository
  loginAccount: LoginAccount
  completeSecondFactor: CompleteSecondFactor
  avisos: string[]
}

const AHORA = new Date('2026-09-02T12:00:00.000Z')
const CADUCA = new Date(AHORA.getTime() + 900_000)

/**
 * Verificador de testimonios para pruebas.
 *
 * Devuelve el sujeto que se le indique, con un `jti` distinto por token, para
 * poder ejercitar la evidencia sin firmar JWT reales. La comprobacion de firma
 * la cubren las pruebas del verificador de Cognito.
 */
const verificadorDePruebas = (
  subject: () => string,
  overrides: { jti?: string | null; expiresAt?: Date | null } = {},
): TokenVerifierPort => ({
  verify: (token: string): Promise<VerifiedIdentity> =>
    Promise.resolve({
      subject: subject(),
      roles: new Set([Role.Player]),
      jti: overrides.jti === undefined ? `jti-${token}` : overrides.jti,
      expiresAt: overrides.expiresAt === undefined ? CADUCA : overrides.expiresAt,
    }),
})

const buildLoginHarness = (
  options: {
    tokenVerifier?: TokenVerifierPort
    mfaEvidence?: MfaEvidenceRepositoryPort
  } = {},
): LoginHarness => {
  const accounts = new InMemoryAccountRepository()
  const authProvider = new FakeAuthenticationProvider(sequence('token'))
  const mfaEvidence = new InMemoryMfaEvidenceRepository()
  const avisos: string[] = []
  let ultimoSujeto = ''

  // El doble del verificador devuelve el sujeto de la cuenta que se acaba de
  // autenticar, que es lo que hace un proveedor real.
  const original = accounts.save.bind(accounts)
  accounts.save = async (account): Promise<void> => {
    ultimoSujeto = account.subject
    await original(account)
  }

  const deps = {
    accounts,
    authenticationProvider: authProvider,
    tokenVerifier: options.tokenVerifier ?? verificadorDePruebas(() => ultimoSujeto),
    mfaEvidence: options.mfaEvidence ?? mfaEvidence,
    clock: { now: (): Date => AHORA },
    logger: {
      warn: (message: string): void => {
        avisos.push(message)
      },
    },
  }

  return {
    accounts,
    authProvider,
    mfaEvidence,
    avisos,
    loginAccount: new LoginAccount({ accounts, authenticationProvider: authProvider }),
    completeSecondFactor: new CompleteSecondFactor(deps),
  }
}

/**
 * Cubre HU-02 (Nexus-Battle-Management#11) y su task HU-02.1 (#90): la lista
 * de "Pruebas y evidencia esperada" de la task se corresponde con los `it` de
 * este bloque uno a uno.
 */
describe('LoginAccount', () => {
  it('identifica la cuenta por correo', async () => {
    const harness = buildLoginHarness()
    await harness.accounts.save(buildActiveAccount({ email: 'jugador@nexus.test' }))
    harness.authProvider.seed({ email: 'jugador@nexus.test', password: VALID_PASSWORD })

    const outcome = await harness.loginAccount.execute({
      identifier: 'jugador@nexus.test',
      password: VALID_PASSWORD,
    })

    expect(outcome).toMatchObject({ kind: 'authenticated' })
  })

  /**
   * `account.id` es el identificador de Account; `subject` es el `sub` real
   * del proveedor. Son valores DISTINTOS a proposito en este fixture
   * (`buildActiveAccount` los genera por separado): esta prueba falla si
   * algun dia alguien confunde uno con el otro.
   */
  it('entrega el subject real, distinto de account.id', async () => {
    const harness = buildLoginHarness()
    await harness.accounts.save(
      buildActiveAccount({
        id: 'acc-42',
        subject: 'sujeto-cognito-real',
        email: 'jugador@nexus.test',
      }),
    )
    harness.authProvider.seed({ email: 'jugador@nexus.test', password: VALID_PASSWORD })

    const outcome = await harness.loginAccount.execute({
      identifier: 'jugador@nexus.test',
      password: VALID_PASSWORD,
    })

    if (outcome.kind !== 'authenticated') {
      throw new Error('se esperaba autenticacion completada')
    }

    expect(outcome.subject).toBe('sujeto-cognito-real')
    expect(outcome.account.id).toBe('acc-42')
    expect(outcome.subject).not.toBe(outcome.account.id)
  })

  it('identifica la cuenta por apodo, sin que quien llama sepa su correo', async () => {
    const harness = buildLoginHarness()
    await harness.accounts.save(
      buildActiveAccount({ email: 'jugador@nexus.test', displayName: 'Ana Ramirez' }),
    )
    harness.authProvider.seed({ email: 'jugador@nexus.test', password: VALID_PASSWORD })

    const outcome = await harness.loginAccount.execute({
      identifier: 'Ana Ramirez',
      password: VALID_PASSWORD,
    })

    expect(outcome).toMatchObject({ kind: 'authenticated' })
  })

  it('rechaza un identificador que no corresponde a ninguna cuenta', async () => {
    const harness = buildLoginHarness()

    await expect(
      harness.loginAccount.execute({ identifier: 'nadie@nexus.test', password: 'lo-que-sea' }),
    ).resolves.toEqual({ kind: 'invalidCredentials' })
  })

  it('rechaza una contrasena incorrecta', async () => {
    const harness = buildLoginHarness()
    await harness.accounts.save(buildActiveAccount())
    harness.authProvider.seed({ email: 'jugador@nexus.test', password: VALID_PASSWORD })

    await expect(
      harness.loginAccount.execute({ identifier: 'jugador@nexus.test', password: 'Incorrecta1!' }),
    ).resolves.toEqual({ kind: 'invalidCredentials' })
  })

  it('rechaza una cuenta pendiente de verificacion, con el mismo resultado que credenciales invalidas', async () => {
    const harness = buildLoginHarness()
    await harness.accounts.saveRegistration(buildAccount(), []) // nace PENDING_VERIFICATION
    harness.authProvider.seed({ email: 'jugador@nexus.test', password: VALID_PASSWORD })

    await expect(
      harness.loginAccount.execute({ identifier: 'jugador@nexus.test', password: VALID_PASSWORD }),
    ).resolves.toEqual({ kind: 'invalidCredentials' })
  })

  /**
   * Este es el requisito de no-enumeracion en forma de prueba: "correo
   * inexistente" y "contrasena incorrecta" no deben distinguirse en la salida.
   */
  it('no filtra si el identificador existe: mismo resultado exacto en ambos casos', async () => {
    const harness = buildLoginHarness()
    await harness.accounts.save(buildActiveAccount())
    harness.authProvider.seed({ email: 'jugador@nexus.test', password: VALID_PASSWORD })

    const correoInexistente = await harness.loginAccount.execute({
      identifier: 'nadie@nexus.test',
      password: VALID_PASSWORD,
    })
    const contrasenaIncorrecta = await harness.loginAccount.execute({
      identifier: 'jugador@nexus.test',
      password: 'Incorrecta1!',
    })

    expect(correoInexistente).toEqual(contrasenaIncorrecta)
  })

  it('propaga un fallo inesperado del proveedor como error temporal, no como credenciales invalidas', async () => {
    const harness = buildLoginHarness()
    await harness.accounts.save(buildActiveAccount())
    jest
      .spyOn(harness.authProvider, 'authenticate')
      .mockRejectedValue(new AuthenticationProviderError('el proveedor no responde'))

    await expect(
      harness.loginAccount.execute({ identifier: 'jugador@nexus.test', password: VALID_PASSWORD }),
    ).resolves.toEqual({ kind: 'providerUnavailable' })
  })

  it.each([Role.Player, Role.Moderator])(
    'completa el login sin segundo factor para el rol %s',
    async (role) => {
      const harness = buildLoginHarness()
      await harness.accounts.save(buildActiveAccount({ roles: [Role.Player, role] }))
      harness.authProvider.seed({ email: 'jugador@nexus.test', password: VALID_PASSWORD })

      const outcome = await harness.loginAccount.execute({
        identifier: 'jugador@nexus.test',
        password: VALID_PASSWORD,
      })

      expect(outcome).toMatchObject({ kind: 'authenticated' })
      if (outcome.kind === 'authenticated') {
        expect(outcome.account.roles).toEqual(expect.arrayContaining([role]))
      }
    },
  )

  it.each([Role.Administrator, Role.SuperAdministrator])(
    'exige segundo factor para el rol %s y no entra al flujo administrativo con solo la contrasena',
    async (role) => {
      const harness = buildLoginHarness()
      await harness.accounts.save(buildActiveAccount({ roles: [Role.Player, role] }))
      harness.authProvider.seed({
        email: 'jugador@nexus.test',
        password: VALID_PASSWORD,
        requiresSecondFactor: true,
        secondFactorCode: '123456',
      })

      const outcome = await harness.loginAccount.execute({
        identifier: 'jugador@nexus.test',
        password: VALID_PASSWORD,
      })

      expect(outcome).toMatchObject({ kind: 'secondFactorRequired' })

      /**
       * El reto debe decir DONDE mirar, y no solo que hay reto.
       *
       * Sin este dato la interfaz solo podia adivinar, y adivinaba mal:
       * anunciaba "te enviamos un codigo por correo" mientras el pool retaba
       * con la aplicacion autenticadora y no se enviaba ningun correo. Un
       * mensaje que manda a alguien a revisar un buzon vacio es peor que no
       * decir nada.
       */
      expect(outcome).toMatchObject({ method: 'AUTHENTICATOR_APP' })
    },
  )

  /**
   * CA-06 en su forma mas estricta: el proveedor SI acepto la contrasena y NO
   * emitio ningun reto para una cuenta administrativa. Esto no es un exito: es
   * la brecha de aprovisionamiento descrita en el reporte de HU-02
   * (ADR-004 -MFA de Cognito no confirmado por rol-), y el caso de uso debe
   * fallar cerrado en lugar de conceder la sesion.
   */
  it.each([Role.Administrator, Role.SuperAdministrator])(
    'no concede sesion a %s si el proveedor autentica sin retar el segundo factor',
    async (role) => {
      const harness = buildLoginHarness()
      await harness.accounts.save(buildActiveAccount({ roles: [Role.Player, role] }))
      // Sembrado SIN requiresSecondFactor: el proveedor autentica directo.
      harness.authProvider.seed({ email: 'jugador@nexus.test', password: VALID_PASSWORD })

      const outcome = await harness.loginAccount.execute({
        identifier: 'jugador@nexus.test',
        password: VALID_PASSWORD,
      })

      expect(outcome).toEqual({ kind: 'providerUnavailable' })
    },
  )
})

describe('CompleteSecondFactor', () => {
  const seedAdmin = async (
    harness: LoginHarness,
    role: typeof Role.Administrator | typeof Role.SuperAdministrator = Role.Administrator,
  ): Promise<void> => {
    await harness.accounts.save(buildActiveAccount({ roles: [Role.Player, role] }))
    harness.authProvider.seed({
      email: 'jugador@nexus.test',
      password: VALID_PASSWORD,
      requiresSecondFactor: true,
      secondFactorCode: '123456',
    })
  }

  /** Recorre las dos etapas y devuelve el resultado de la segunda. */
  const completar = async (harness: LoginHarness): Promise<LoginOutcome> => {
    const challenge = await harness.loginAccount.execute({
      identifier: 'jugador@nexus.test',
      password: VALID_PASSWORD,
    })

    if (challenge.kind !== 'secondFactorRequired') {
      throw new Error('se esperaba un reto de segundo factor')
    }

    return await harness.completeSecondFactor.execute({
      identifier: 'jugador@nexus.test',
      challengeToken: challenge.challengeToken,
      code: '123456',
    })
  }

  it('completa la autenticacion administrativa con el codigo correcto (CA-07)', async () => {
    const harness = buildLoginHarness()
    await seedAdmin(harness)

    const challenge = await harness.loginAccount.execute({
      identifier: 'jugador@nexus.test',
      password: VALID_PASSWORD,
    })

    if (challenge.kind !== 'secondFactorRequired') {
      throw new Error('se esperaba un reto de segundo factor')
    }

    const outcome = await harness.completeSecondFactor.execute({
      identifier: 'jugador@nexus.test',
      challengeToken: challenge.challengeToken,
      code: '123456',
    })

    expect(outcome).toMatchObject({ kind: 'authenticated' })
  })

  /**
   * ENDURECIMIENTO POSTERIOR A EN-002.
   *
   * Un access token de Cognito no dice como se obtuvo, asi que un servicio que
   * solo lee el rol no puede distinguir un testimonio nacido tras el segundo
   * factor de otro nacido sin el. Account deja constancia, ligada al `jti` del
   * testimonio concreto.
   */
  it('deja evidencia del segundo factor ligada al testimonio entregado', async () => {
    const harness = buildLoginHarness()
    await seedAdmin(harness)

    const outcome = await completar(harness)

    if (outcome.kind !== 'authenticated') {
      throw new Error('se esperaba una sesion autenticada')
    }

    await expect(
      harness.mfaEvidence.isValidFor(
        outcome.subject,
        `jti-${outcome.accessToken}`,
        SecondFactorMethod.AuthenticatorApp,
        AHORA,
      ),
    ).resolves.toBe(true)

    await expect(
      harness.mfaEvidence.isValidFor(
        outcome.subject,
        `jti-${outcome.accessToken}`,
        SecondFactorMethod.Email,
        AHORA,
      ),
    ).resolves.toBe(false)
  })

  /**
   * EL ORDEN IMPORTA. Entregar el testimonio y persistir despues dejaria
   * sesiones administrativas sin evidencia, indistinguibles de las que nunca
   * superaron el segundo factor. Si la escritura falla, no se entrega nada.
   */
  it('NO entrega el testimonio si la evidencia no se puede persistir', async () => {
    const harness = buildLoginHarness({
      mfaEvidence: {
        save: (): Promise<void> => Promise.reject(new Error('motor caido')),
        isValidFor: (): Promise<boolean> => Promise.resolve(false),
      },
    })
    await seedAdmin(harness)

    const outcome = await completar(harness)

    expect(outcome.kind).toBe('providerUnavailable')
    expect(harness.avisos).toContain('mfa_evidence_no_persistida')
  })

  /**
   * El sujeto que afirma el testimonio debe ser el de la cuenta recien
   * autenticada. Sin esta comprobacion, un desajuste entre proveedor y cuenta
   * registraria la evidencia a nombre de otro sujeto.
   */
  it('NO entrega el testimonio si el sujeto del token no es el de la cuenta', async () => {
    const harness = buildLoginHarness({
      tokenVerifier: verificadorDePruebas(() => 'sujeto-de-otra-persona'),
    })
    await seedAdmin(harness)

    const outcome = await completar(harness)

    expect(outcome.kind).toBe('providerUnavailable')
    expect(harness.avisos).toContain('mfa_evidence_sujeto_discrepante')
  })

  /**
   * Sin `jti` la evidencia no podria ligarse a este testimonio. Guardar algo
   * inventado aparentaria una prueba que no describe ningun token.
   */
  it('NO entrega el testimonio si el token no trae identificador', async () => {
    const cuenta = buildActiveAccount({ roles: [Role.Player, Role.Administrator] })
    const harness = buildLoginHarness({
      tokenVerifier: verificadorDePruebas(() => cuenta.subject, { jti: null }),
    })
    await harness.accounts.save(cuenta)
    harness.authProvider.seed({
      email: 'jugador@nexus.test',
      password: VALID_PASSWORD,
      requiresSecondFactor: true,
      secondFactorCode: '123456',
    })

    const outcome = await completar(harness)

    expect(outcome.kind).toBe('providerUnavailable')
    expect(harness.avisos).toContain('mfa_evidence_token_sin_identificador')
  })

  it('no completa la sesion administrativa con un codigo incorrecto (CA-08)', async () => {
    const harness = buildLoginHarness()
    await seedAdmin(harness)

    const challenge = await harness.loginAccount.execute({
      identifier: 'jugador@nexus.test',
      password: VALID_PASSWORD,
    })

    if (challenge.kind !== 'secondFactorRequired') {
      throw new Error('se esperaba un reto de segundo factor')
    }

    await expect(
      harness.completeSecondFactor.execute({
        identifier: 'jugador@nexus.test',
        challengeToken: challenge.challengeToken,
        code: '000000',
      }),
    ).resolves.toEqual({ kind: 'secondFactorInvalid' })
  })

  it('no completa la sesion administrativa cuando el segundo factor no se completa (CA-08)', async () => {
    const harness = buildLoginHarness()
    await seedAdmin(harness)

    await expect(
      harness.completeSecondFactor.execute({
        identifier: 'jugador@nexus.test',
        challengeToken: 'challenge-nunca-emitido',
        code: '123456',
      }),
    ).resolves.toEqual({ kind: 'secondFactorInvalid' })
  })

  it('rechaza un identificador que no corresponde a ninguna cuenta', async () => {
    const harness = buildLoginHarness()

    await expect(
      harness.completeSecondFactor.execute({
        identifier: 'nadie@nexus.test',
        challengeToken: 'x',
        code: '123456',
      }),
    ).resolves.toEqual({ kind: 'invalidCredentials' })
  })

  it('propaga un fallo inesperado del proveedor como error temporal', async () => {
    const harness = buildLoginHarness()
    await seedAdmin(harness)
    jest
      .spyOn(harness.authProvider, 'verifySecondFactor')
      .mockRejectedValue(new AuthenticationProviderError('el proveedor no responde'))

    await expect(
      harness.completeSecondFactor.execute({
        identifier: 'jugador@nexus.test',
        challengeToken: 'cualquiera',
        code: '123456',
      }),
    ).resolves.toEqual({ kind: 'providerUnavailable' })
  })
})
