import { InMemoryAccountRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountRepository'
import { InMemoryNicknameBlacklist } from '../../src/adapters/outbound/persistence/InMemoryNicknameBlacklist'
import {
  NICKNAME_BLACKLIST_SEED,
  buildBlacklistSeed,
} from '../../src/adapters/outbound/persistence/nickname-blacklist-seed'
import { FakeAuthenticationProvider } from '../../src/adapters/outbound/identity/FakeAuthenticationProvider'
import { LoggingNotificationRequester } from '../../src/adapters/outbound/messaging/LoggingNotificationRequester'
import { HttpNotificationRequester } from '../../src/adapters/outbound/messaging/HttpNotificationRequester'
import { SystemClock } from '../../src/adapters/outbound/system/SystemClock'
import { UuidGenerator } from '../../src/adapters/outbound/system/UuidGenerator'
import { AccountId } from '../../src/domain/value-objects/AccountId'
import { DisplayName } from '../../src/domain/value-objects/DisplayName'
import { EmailAddress } from '../../src/domain/value-objects/EmailAddress'
import { AccountStatus } from '../../src/domain/entities/AccountStatus'
import { applyEnvFile, ConfigurationError, loadConfig } from '../../src/infrastructure/config/env'
import { createLogger } from '../../src/infrastructure/observability/logger'
import { buildLiveness, buildReadiness, buildVersion } from '../../src/infrastructure/health/health'
import { LocalAvatarStorage } from '../../src/adapters/outbound/storage/LocalAvatarStorage'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AT, VALID_PASSWORD, buildAccount } from '../support/account-factory'

describe('InMemoryAccountRepository', () => {
  it('guarda y recupera por identificador', async () => {
    const repository = new InMemoryAccountRepository()
    const account = buildAccount()

    await repository.save(account)
    const found = await repository.findById(AccountId.create('acc-1'))

    expect(found?.toSnapshot()).toEqual(account.toSnapshot())
    expect(repository.size).toBe(1)
  })

  it('devuelve null cuando el identificador no existe', async () => {
    const repository = new InMemoryAccountRepository()

    expect(await repository.findById(AccountId.create('acc-x'))).toBeNull()
    expect(await repository.findByEmail(EmailAddress.create('nadie@nexus.test'))).toBeNull()
  })

  it('responde a la unicidad del apodo sin distinguir mayusculas', async () => {
    const repository = new InMemoryAccountRepository()
    await repository.save(buildAccount())

    expect(await repository.existsByDisplayName(DisplayName.create('Ana Ramirez'))).toBe(true)
    expect(await repository.existsByDisplayName(DisplayName.create('ANA RAMIREZ'))).toBe(true)
    expect(await repository.existsByDisplayName(DisplayName.create('Otro Apodo'))).toBe(false)
  })

  it('recupera por correo y responde a la comprobacion de existencia', async () => {
    const repository = new InMemoryAccountRepository()
    await repository.save(buildAccount())

    expect(
      (await repository.findByEmail(EmailAddress.create('jugador@nexus.test')))?.id.value,
    ).toBe('acc-1')
    expect(await repository.existsByEmail(EmailAddress.create('jugador@nexus.test'))).toBe(true)
    expect(await repository.existsByEmail(EmailAddress.create('otro@nexus.test'))).toBe(false)
  })

  it('almacena instantaneas, no referencias vivas al agregado', async () => {
    const repository = new InMemoryAccountRepository()
    const account = buildAccount()
    await repository.save(account)

    // Se muta el agregado sin volver a guardarlo.
    account.verify(AT)

    const stored = await repository.findById(AccountId.create('acc-1'))

    expect(stored?.currentStatus).toBe(AccountStatus.PendingVerification)
    expect(account.currentStatus).toBe(AccountStatus.Active)
  })

  it('sobrescribe la instantanea al volver a guardar', async () => {
    const repository = new InMemoryAccountRepository()
    const account = buildAccount()
    await repository.save(account)

    account.verify(AT)
    await repository.save(account)

    expect((await repository.findById(AccountId.create('acc-1')))?.currentStatus).toBe(
      AccountStatus.Active,
    )
    expect(repository.size).toBe(1)
  })

  it('permite vaciar el almacen', async () => {
    const repository = new InMemoryAccountRepository()
    await repository.save(buildAccount())

    repository.clear()

    expect(repository.size).toBe(0)
  })

  it('recupera por apodo sin distinguir mayusculas (HU-02)', async () => {
    const repository = new InMemoryAccountRepository()
    await repository.save(buildAccount())

    expect((await repository.findByDisplayName(DisplayName.create('Ana Ramirez')))?.id.value).toBe(
      'acc-1',
    )
    expect((await repository.findByDisplayName(DisplayName.create('ANA RAMIREZ')))?.id.value).toBe(
      'acc-1',
    )
  })

  it('devuelve null para un apodo que no corresponde a ninguna cuenta', async () => {
    const repository = new InMemoryAccountRepository()
    await repository.save(buildAccount())

    expect(await repository.findByDisplayName(DisplayName.create('Nadie Aqui'))).toBeNull()
  })
})

describe('FakeAuthenticationProvider', () => {
  const nextToken = (): (() => string) => {
    let counter = 0

    return (): string => {
      counter += 1

      return `t-${String(counter)}`
    }
  }

  it('rechaza un correo que no fue sembrado', async () => {
    const provider = new FakeAuthenticationProvider(nextToken())

    await expect(
      provider.authenticate({ email: 'nadie@nexus.test', password: 'lo-que-sea' }),
    ).resolves.toEqual({ kind: 'invalidCredentials' })
  })

  it('rechaza una contrasena que no corresponde al correo sembrado', async () => {
    const provider = new FakeAuthenticationProvider(nextToken())
    provider.seed({ email: 'jugador@nexus.test', password: VALID_PASSWORD })

    await expect(
      provider.authenticate({ email: 'jugador@nexus.test', password: 'Otra-Clave1!' }),
    ).resolves.toEqual({ kind: 'invalidCredentials' })
  })

  it('autentica sin segundo factor cuando no fue sembrado como administrativo', async () => {
    const provider = new FakeAuthenticationProvider(nextToken())
    provider.seed({ email: 'jugador@nexus.test', password: VALID_PASSWORD })

    const outcome = await provider.authenticate({
      email: 'JUGADOR@Nexus.test',
      password: VALID_PASSWORD,
    })

    expect(outcome.kind).toBe('authenticated')
  })

  it('exige segundo factor cuando el correo fue sembrado como administrativo', async () => {
    const provider = new FakeAuthenticationProvider(nextToken())
    provider.seed({
      email: 'admin@nexus.test',
      password: VALID_PASSWORD,
      requiresSecondFactor: true,
      secondFactorCode: '123456',
    })

    const outcome = await provider.authenticate({
      email: 'admin@nexus.test',
      password: VALID_PASSWORD,
    })

    expect(outcome).toMatchObject({ kind: 'challengeRequired' })
  })

  it('verifica el segundo factor con el codigo correcto y lo invalida tras usarlo', async () => {
    const provider = new FakeAuthenticationProvider(nextToken())
    provider.seed({
      email: 'admin@nexus.test',
      password: VALID_PASSWORD,
      requiresSecondFactor: true,
      secondFactorCode: '123456',
    })

    const challenge = await provider.authenticate({
      email: 'admin@nexus.test',
      password: VALID_PASSWORD,
    })

    if (challenge.kind !== 'challengeRequired') {
      throw new Error('se esperaba un reto de segundo factor')
    }

    const verified = await provider.verifySecondFactor({
      email: 'admin@nexus.test',
      challengeToken: challenge.challengeToken,
      code: '123456',
    })

    expect(verified.kind).toBe('verified')

    // El mismo reto no puede reutilizarse una vez consumido.
    await expect(
      provider.verifySecondFactor({
        email: 'admin@nexus.test',
        challengeToken: challenge.challengeToken,
        code: '123456',
      }),
    ).resolves.toEqual({ kind: 'challengeExpired' })
  })

  it('rechaza un codigo de segundo factor incorrecto', async () => {
    const provider = new FakeAuthenticationProvider(nextToken())
    provider.seed({
      email: 'admin@nexus.test',
      password: VALID_PASSWORD,
      requiresSecondFactor: true,
      secondFactorCode: '123456',
    })

    const challenge = await provider.authenticate({
      email: 'admin@nexus.test',
      password: VALID_PASSWORD,
    })

    if (challenge.kind !== 'challengeRequired') {
      throw new Error('se esperaba un reto de segundo factor')
    }

    await expect(
      provider.verifySecondFactor({
        email: 'admin@nexus.test',
        challengeToken: challenge.challengeToken,
        code: '000000',
      }),
    ).resolves.toEqual({ kind: 'invalidCode' })
  })

  it('rechaza un token de reto desconocido', async () => {
    const provider = new FakeAuthenticationProvider(nextToken())

    await expect(
      provider.verifySecondFactor({
        email: 'admin@nexus.test',
        challengeToken: 'challenge-inventado',
        code: '123456',
      }),
    ).resolves.toEqual({ kind: 'challengeExpired' })
  })
})

describe('LoggingNotificationRequester', () => {
  it('registra la solicitud sin exponer la direccion completa', async () => {
    const lines: string[] = []
    const logger = createLogger({
      level: 'info',
      service: 'account',
      version: '0.1.0',
      sink: (line) => lines.push(line),
    })

    await new LoggingNotificationRequester(logger).request({
      notificationId: 'acc-1',
      recipient: 'jugador@nexus.test',
      templateId: 'account-welcome',
      variables: { displayName: 'Ana' },
    })

    const entry = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>

    expect(entry).toMatchObject({
      message: 'notification_requested',
      notificationId: 'acc-1',
      templateId: 'account-welcome',
      recipientDomain: 'nexus.test',
    })
    expect(lines[0]).not.toContain('jugador@nexus.test')
  })

  it('tolera un destinatario sin dominio reconocible', async () => {
    const lines: string[] = []
    const logger = createLogger({
      level: 'info',
      service: 'account',
      version: '0.1.0',
      sink: (line) => lines.push(line),
    })

    await new LoggingNotificationRequester(logger).request({
      notificationId: 'acc-1',
      recipient: 'sin-arroba',
      templateId: 'account-welcome',
      variables: {},
    })

    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ recipientDomain: 'desconocido' })
  })
})

describe('HttpNotificationRequester', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('publica la solicitud al ingest sin exponer el correo completo', async () => {
    const lines: string[] = []
    const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 202 }))
    globalThis.fetch = fetchImpl

    await new HttpNotificationRequester({
      ingestUrl: 'http://127.0.0.1:3001/dev/enqueue',
      logger: createLogger({
        level: 'info',
        service: 'account',
        version: '0.1.0',
        sink: (line) => lines.push(line),
      }),
    }).request({
      notificationId: 'n-1',
      recipient: 'qfue11481@gmail.com',
      templateId: 'account-password-recovery-code',
      variables: { code: '000000' },
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:3001/dev/enqueue',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(lines[0]).not.toContain('qfue11481@gmail.com')
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      templateId: 'account-password-recovery-code',
      recipientDomain: 'gmail.com',
    })
  })
})

describe('LocalAvatarStorage', () => {
  it('escribe y elimina el archivo bajo la ruta configurada', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'avatars-'))
    const storage = new LocalAvatarStorage(dir)

    const stored = await storage.store({
      accountId: 'acc-1',
      mimeType: 'image/png',
      originalName: 'foto.png',
      bytes: Buffer.from('abc'),
    })

    expect(await readFile(path.join(dir, stored.storageKey), 'utf8')).toBe('abc')

    await storage.remove(stored.storageKey)
  })
})

describe('SystemClock y UuidGenerator', () => {
  it('el reloj devuelve un instante no anterior al actual', () => {
    const before = Date.now()

    expect(new SystemClock().now().getTime()).toBeGreaterThanOrEqual(before)
  })

  it('el generador produce identificadores unicos con forma de UUID', () => {
    const generator = new UuidGenerator()
    const first = generator.generate()
    const second = generator.generate()

    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(first).not.toBe(second)
  })
})

describe('loadConfig', () => {
  it('aplica valores por defecto seguros para el entorno local', () => {
    expect(loadConfig({})).toMatchObject({
      nodeEnv: 'development',
      serviceName: 'nexus-battle-account',
      logLevel: 'info',
      port: 3000,
      globalPrefix: 'api',
      swaggerEnabled: true,
      persistenceDriver: 'memory',
      databaseUrl: null,
      authMode: 'disabled',
      cognito: null,
      avatarStoragePath: './data/avatars',
      corsOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
      notificationsIngestUrl: null,
    })
  })

  it('lee el ingest local de Notifications cuando esta informado', () => {
    expect(
      loadConfig({ NOTIFICATIONS_INGEST_URL: 'http://127.0.0.1:3001/dev/enqueue' })
        .notificationsIngestUrl,
    ).toBe('http://127.0.0.1:3001/dev/enqueue')
  })

  /**
   * `catalog` y `community` son los dos consumidores previstos hoy del
   * contrato interno de evidencia MFA. Sin este valor por defecto, el
   * endurecimiento de Community (`INTERNAL_SERVICE_NAME=community` en ese
   * servicio) fallaria cerrado en cualquier entorno que no configurara la
   * variable explicitamente -sintoma dificil de atribuir: 401 sin motivo
   * visible en los logs de Community-.
   */
  it('permite catalog y community por defecto en el contrato interno', () => {
    expect(loadConfig({}).internalServiceAllowed).toEqual(['catalog', 'community'])
  })

  it('una lista explicita reemplaza el valor por defecto, normalizada', () => {
    expect(
      loadConfig({ INTERNAL_SERVICE_ALLOWED_SERVICES: ' Catalog , OTRO ' }).internalServiceAllowed,
    ).toEqual(['catalog', 'otro'])
  })

  // Produccion exige autenticacion configurada: `loadConfig` rechaza arrancar
  // sin ella. Estas pruebas la aportan porque su objeto es la documentacion
  // interactiva, no la autenticacion, que se ejercita en auth.spec.ts.
  const PRODUCTION_ENV = {
    NODE_ENV: 'production',
    AUTH_MODE: 'jwt',
    AUTHENTICATION_DRIVER: 'cognito',
    COGNITO_USER_POOL_ID: 'us-east-1_abc',
    COGNITO_CLIENT_ID: 'cliente',
  } as const

  it('en produccion no abre CORS salvo lista explicita, y rechaza *', () => {
    expect(loadConfig(PRODUCTION_ENV).corsOrigins).toEqual([])
    expect(
      loadConfig({ ...PRODUCTION_ENV, CORS_ORIGINS: 'https://app.nexus.test' }).corsOrigins,
    ).toEqual(['https://app.nexus.test'])
    expect(() => loadConfig({ ...PRODUCTION_ENV, CORS_ORIGINS: '*' })).toThrow(/CORS_ORIGINS/)
  })

  it('deshabilita la documentacion interactiva en produccion por defecto', () => {
    expect(loadConfig(PRODUCTION_ENV).swaggerEnabled).toBe(false)
  })

  it('permite habilitar la documentacion de forma explicita', () => {
    expect(loadConfig({ ...PRODUCTION_ENV, SWAGGER_ENABLED: 'true' }).swaggerEnabled).toBe(true)
  })

  it('lee la configuracion aportada por el entorno', () => {
    expect(
      loadConfig({
        NODE_ENV: 'test',
        LOG_LEVEL: 'debug',
        PORT: '8080',
        GLOBAL_PREFIX: 'v1',
        SERVICE_VERSION: '1.2.3',
        PERSISTENCE_DRIVER: 'postgres',
        DATABASE_URL: 'postgres://usuario@localhost:5432/account',
      }),
    ).toMatchObject({
      nodeEnv: 'test',
      logLevel: 'debug',
      port: 8080,
      globalPrefix: 'v1',
      version: '1.2.3',
      persistenceDriver: 'postgres',
    })
  })

  it('exige la cadena de conexion cuando el driver es postgres', () => {
    expect(() => loadConfig({ PERSISTENCE_DRIVER: 'postgres' })).toThrow(
      /DATABASE_URL es obligatorio/,
    )
  })

  it('applyEnvFile no falla si el archivo no existe', () => {
    expect(() => {
      applyEnvFile(path.join(tmpdir(), 'nexus-sin-env'))
    }).not.toThrow()
  })

  it('applyEnvFile carga claves nuevas y no pisa las ya definidas', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nexus-env-'))

    process.env.NEXUS_ACCOUNT_ENV_EXISTING = 'previo'
    delete process.env.NEXUS_ACCOUNT_ENV_FRESH

    await writeFile(
      path.join(dir, '.env'),
      'NEXUS_ACCOUNT_ENV_EXISTING=desde-archivo\nNEXUS_ACCOUNT_ENV_FRESH=desde-archivo\n',
    )

    try {
      applyEnvFile(dir)
      expect(process.env.NEXUS_ACCOUNT_ENV_EXISTING).toBe('previo')
      expect(process.env.NEXUS_ACCOUNT_ENV_FRESH).toBe('desde-archivo')
    } finally {
      delete process.env.NEXUS_ACCOUNT_ENV_EXISTING
      delete process.env.NEXUS_ACCOUNT_ENV_FRESH
    }
  })

  it.each([
    ['un valor fuera del catalogo', { LOG_LEVEL: 'verbose' }],
    ['un entero mal formado', { PORT: 'abc' }],
    ['un puerto fuera de rango', { PORT: '99999' }],
    ['un booleano invalido', { SWAGGER_ENABLED: 'si' }],
  ])('rechaza %s', (_caso, env) => {
    expect(() => loadConfig(env)).toThrow(ConfigurationError)
  })
})

describe('createLogger', () => {
  const capture = (
    level: 'debug' | 'info' | 'warn' | 'error',
  ): { lines: string[]; logger: ReturnType<typeof createLogger> } => {
    const lines: string[] = []

    return {
      lines,
      logger: createLogger({
        level,
        service: 'account',
        version: '0.1.0',
        sink: (line) => lines.push(line),
        clock: () => AT,
      }),
    }
  }

  it('emite JSON estructurado con metadatos del servicio', () => {
    const { lines, logger } = capture('info')

    logger.info('mensaje', { accountId: 'acc-1', intentos: 2, forzado: false, motivo: null })

    expect(JSON.parse(lines[0] ?? '{}')).toEqual({
      timestamp: '2026-08-21T10:00:00.000Z',
      level: 'info',
      service: 'account',
      version: '0.1.0',
      message: 'mensaje',
      accountId: 'acc-1',
      intentos: 2,
      forzado: false,
      motivo: null,
    })
  })

  it('descarta los registros por debajo del umbral', () => {
    const { lines, logger } = capture('warn')

    logger.debug('no')
    logger.info('no')
    logger.warn('si')
    logger.error('si')

    expect(lines).toHaveLength(2)
  })

  it('admite registros sin contexto en todos los niveles', () => {
    const { lines, logger } = capture('debug')

    logger.debug('a')
    logger.info('b')
    logger.warn('c')
    logger.error('d')

    expect(lines).toHaveLength(4)
  })
})

describe('sondas de salud', () => {
  it('liveness solo confirma que el proceso responde', () => {
    expect(buildLiveness()).toEqual({ status: 'ok', checks: {} })
  })

  it('readiness es ok cuando todas las comprobaciones pasan', () => {
    expect(buildReadiness([{ name: 'repo', check: (): boolean => true }])).toEqual({
      status: 'ok',
      checks: { repo: 'ok' },
    })
  })

  it('readiness falla si alguna comprobacion no pasa', () => {
    expect(
      buildReadiness([
        { name: 'repo', check: (): boolean => true },
        { name: 'identidad', check: (): boolean => false },
      ]),
    ).toEqual({ status: 'error', checks: { repo: 'ok', identidad: 'error' } })
  })

  it('readiness trata una excepcion como fallo, no como exito', () => {
    expect(
      buildReadiness([
        {
          name: 'repo',
          check: (): boolean => {
            throw new Error('sin conexion')
          },
        },
      ]),
    ).toEqual({ status: 'error', checks: { repo: 'error' } })
  })

  it('version expone servicio, version y entorno', () => {
    expect(buildVersion({ service: 'account', version: '0.1.0', nodeEnv: 'test' })).toEqual({
      service: 'account',
      version: '0.1.0',
      nodeEnv: 'test',
    })
  })
})

describe('Semilla de lista negra', () => {
  it('no repite identificadores ni terminos', () => {
    const ids = NICKNAME_BLACKLIST_SEED.map((entry) => entry.id)
    const terms = NICKNAME_BLACKLIST_SEED.map((entry) => entry.term.toLowerCase())

    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(terms).size).toBe(terms.length)
    expect(NICKNAME_BLACKLIST_SEED.length).toBeGreaterThan(400)
  })

  it('descarta vacios y duplicados al construir la semilla', () => {
    expect(buildBlacklistSeed([' Admin ', 'admin', '', 'petro'])).toEqual([
      { id: 'bl-admin', term: 'Admin' },
      { id: 'bl-petro', term: 'petro' },
    ])
  })

  it('nace hidratada y bloquea un termino de la semilla', async () => {
    const blacklist = new InMemoryNicknameBlacklist()

    expect(await blacklist.isBlocked('Ana Ramirez')).toBe(false)
    expect(await blacklist.isBlocked('NexusAdmin')).toBe(true)
  })
})
