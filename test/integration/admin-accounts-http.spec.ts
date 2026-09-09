import 'reflect-metadata'

import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import request from 'supertest'

import { AppModule } from '../../src/infrastructure/bootstrap/app.module'
import { Role } from '../../src/domain/entities/Role'
import { AccountStatus } from '../../src/domain/entities/AccountStatus'
import { Account } from '../../src/domain/entities/Account'
import { AccountId } from '../../src/domain/value-objects/AccountId'
import { DisplayName } from '../../src/domain/value-objects/DisplayName'
import { EmailAddress } from '../../src/domain/value-objects/EmailAddress'
import { PersonName } from '../../src/domain/value-objects/PersonName'
import {
  TOKEN_VERIFIER,
  TokenVerificationError,
  type TokenVerifierPort,
  type VerifiedIdentity,
} from '../../src/application/ports/TokenVerifierPort'
import { ACCOUNT_REPOSITORY } from '../../src/application/ports/AccountRepositoryPort'
import type { AccountRepositoryPort } from '../../src/application/ports/AccountRepositoryPort'
import { IDENTITY_SIGN_UP } from '../../src/application/ports/IdentitySignUpPort'
import { ROLE_DIRECTORY } from '../../src/application/ports/RoleDirectoryPort'
import { MFA_STATUS } from '../../src/application/ports/MfaStatusPort'
import { SESSION_REVOCATION } from '../../src/application/ports/SessionRevocationPort'
import { InMemoryIdentitySignUp } from '../../src/adapters/outbound/identity/InMemoryIdentitySignUp'
import { InMemoryRoleDirectory } from '../../src/adapters/outbound/identity/InMemoryRoleDirectory'
import { InMemoryMfaStatus } from '../../src/adapters/outbound/identity/InMemoryMfaStatus'
import { InMemorySessionRevocation } from '../../src/adapters/outbound/identity/InMemorySessionRevocation'
import { defaultAvatarMetadata } from '../support/account-factory'
import { SANCTION_REPOSITORY } from '../../src/application/ports/SanctionRepositoryPort'
import type { InMemorySanctionRepository } from '../../src/adapters/outbound/persistence/InMemorySanctionRepository'
import { Sanction } from '../../src/domain/entities/Sanction'
import { SanctionType } from '../../src/domain/entities/SanctionType'

interface AccountSeed {
  readonly id: string
  readonly subject: string
  readonly email: string
  readonly displayName: string
  readonly firstNames: string
  readonly lastNames: string
  readonly status: AccountStatus
  readonly roles: readonly Role[]
}

const IDENTITIES: Readonly<Record<string, VerifiedIdentity>> = {
  'token-player': {
    subject: 'subject-player-caller',
    roles: new Set([Role.Player]),
    jti: null,
    expiresAt: null,
  },
  'token-moderator': {
    subject: 'subject-moderator-caller',
    roles: new Set([Role.Player, Role.Moderator]),
    jti: null,
    expiresAt: null,
  },

  'token-admin': {
    subject: 'subject-admin-caller',
    roles: new Set([Role.Player, Role.Administrator]),
    jti: null,
    expiresAt: null,
  },

  'token-super': {
    subject: 'subject-super-caller',
    roles: new Set([Role.SuperAdministrator]),
    jti: null,
    expiresAt: null,
  },
  'token-expired-admin': {
    subject: 'subject-expired-admin',
    roles: new Set([Role.Administrator]),
    jti: null,
    expiresAt: null,
  },
}

const SEEDS: readonly AccountSeed[] = [
  {
    id: 'acc-panel-banned',
    subject: 'subject-panel-banned',
    email: 'panel.banned@nexus.test',
    displayName: 'Jugador Baneado',
    firstNames: 'Diego',
    lastNames: 'Torres',
    status: AccountStatus.Banned,
    roles: [Role.Player],
  },
  {
    id: 'acc-panel-admin',
    subject: 'subject-panel-admin',
    email: 'panel.admin@nexus.test',
    displayName: 'Capitana Panel',
    firstNames: 'Ana Maria',
    lastNames: 'Vega',
    status: AccountStatus.Active,
    roles: [Role.Player, Role.Administrator],
  },
  {
    id: 'acc-panel-super',
    subject: 'subject-panel-super',
    email: 'panel.super@nexus.test',
    displayName: 'Raiz Panel',
    firstNames: 'Sofia',
    lastNames: 'Vega',
    status: AccountStatus.Active,
    roles: [Role.SuperAdministrator],
  },
  {
    id: 'acc-panel-suspended',
    subject: 'subject-panel-suspended',
    email: 'panel.suspended@nexus.test',
    displayName: 'Moderadora Panel',
    firstNames: 'Bruno',
    lastNames: 'Rojas',
    status: AccountStatus.Suspended,
    roles: [Role.Player, Role.Moderator],
  },
]

const stubVerifier: TokenVerifierPort = {
  verify: (token: string): Promise<VerifiedIdentity> => {
    const identity = IDENTITIES[token]

    return identity === undefined
      ? Promise.reject(new TokenVerificationError())
      : Promise.resolve(identity)
  },
}

const buildAccount = (seed: AccountSeed): Account =>
  Account.restore({
    id: AccountId.create(seed.id),
    subject: seed.subject,
    email: EmailAddress.create(seed.email),
    displayName: DisplayName.create(seed.displayName),
    firstNames: PersonName.create(seed.firstNames, 'Los nombres'),
    lastNames: PersonName.create(seed.lastNames, 'Los apellidos'),
    termsAccepted: true,
    avatar: defaultAvatarMetadata(seed.id),
    status: seed.status,
    roles: seed.roles,
  })

describe('Listado administrativo de cuentas HU-44.2', () => {
  let app: INestApplication
  let previousEnv: Record<string, string | undefined>

  beforeAll(async () => {
    previousEnv = {
      AUTH_MODE: process.env.AUTH_MODE,
      COGNITO_USER_POOL_ID: process.env.COGNITO_USER_POOL_ID,
      COGNITO_CLIENT_ID: process.env.COGNITO_CLIENT_ID,
    }

    process.env.AUTH_MODE = 'jwt'
    process.env.COGNITO_USER_POOL_ID = 'us-east-1_pruebas'
    process.env.COGNITO_CLIENT_ID = 'cliente-de-pruebas'

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TOKEN_VERIFIER)
      .useValue(stubVerifier)
      .overrideProvider(ROLE_DIRECTORY)
      .useValue(new InMemoryRoleDirectory())
      .overrideProvider(IDENTITY_SIGN_UP)
      .useValue(new InMemoryIdentitySignUp())
      .overrideProvider(MFA_STATUS)
      .useValue(new InMemoryMfaStatus())
      .overrideProvider(SESSION_REVOCATION)
      .useValue(new InMemorySessionRevocation())
      .compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('api')
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )

    await app.init()

    const accounts = app.get<AccountRepositoryPort>(ACCOUNT_REPOSITORY)

    jest.useFakeTimers()
    try {
      for (const [index, seed] of SEEDS.entries()) {
        jest.setSystemTime(new Date(`2026-08-0${String(index + 1)}T10:00:00.000Z`))
        await accounts.save(buildAccount(seed))
      }
    } finally {
      jest.useRealTimers()
    }

    const sanctions = app.get<InMemorySanctionRepository>(SANCTION_REPOSITORY)
    for (const [targetAccountId, type] of [
      ['acc-panel-admin', SanctionType.Warning],
      ['acc-panel-suspended', SanctionType.TemporarySuspension],
      ['acc-panel-banned', SanctionType.PermanentBan],
    ] as const) {
      await sanctions.save(
        Sanction.create({
          id: `sanction-${targetAccountId}`,
          targetAccountId,
          actorAccountId: 'acc-panel-super',
          type,
          reason: 'Causal sintetica HU-44.2',
          createdAt: new Date('2020-01-01T00:00:00.000Z'),
          expiresAt:
            type === SanctionType.TemporarySuspension ? new Date('2020-01-02T00:00:00.000Z') : null,
        }),
      )
    }
  })

  afterAll(async () => {
    await app.close()

    for (const [key, value] of Object.entries(previousEnv)) {
      process.env[key] = value ?? ''
    }
  })

  const bearer = (token: string): string => `Bearer ${token}`
  const list = (query = ''): string => `/api/accounts${query}`

  it.each([
    [
      'solo desde inclusivo',
      { registeredFrom: '2026-08-02T10:00:00Z' },
      ['acc-panel-admin', 'acc-panel-super', 'acc-panel-suspended'],
    ],
    [
      'solo hasta inclusivo',
      { registeredTo: '2026-08-03T10:00:00Z' },
      ['acc-panel-admin', 'acc-panel-banned', 'acc-panel-super'],
    ],
    [
      'ambos limites inclusivos',
      { registeredFrom: '2026-08-02T10:00:00Z', registeredTo: '2026-08-03T10:00:00Z' },
      ['acc-panel-admin', 'acc-panel-super'],
    ],
    [
      'limites iguales y offset normalizado a UTC',
      { registeredFrom: '2026-08-02T05:00:00-05:00', registeredTo: '2026-08-02T10:00:00.000Z' },
      ['acc-panel-admin'],
    ],
    [
      'fuera por debajo',
      { registeredFrom: '2026-08-02T10:00:00.001Z' },
      ['acc-panel-super', 'acc-panel-suspended'],
    ],
    ['fuera por encima', { registeredTo: '2026-08-02T09:59:59.999Z' }, ['acc-panel-banned']],
    [
      'rango vacio',
      { registeredFrom: '2027-01-01T00:00:00Z', registeredTo: '2027-02-01T00:00:00Z' },
      [],
    ],
    [
      'fecha y busqueda',
      { registeredFrom: '2026-08-02T10:00:00Z', firstNames: 'ana maria' },
      ['acc-panel-admin'],
    ],
    [
      'fecha y rol',
      { registeredTo: '2026-08-04T10:00:00Z', role: 'MODERATOR' },
      ['acc-panel-suspended'],
    ],
    [
      'fecha y estado',
      { registeredTo: '2026-08-02T10:00:00Z', status: 'BANNED' },
      ['acc-panel-banned'],
    ],
    [
      'fecha y historial',
      { registeredFrom: '2026-08-02T10:00:00Z', hasSanctionHistory: 'false' },
      ['acc-panel-super'],
    ],
    [
      'fecha y multiples filtros AND',
      {
        registeredFrom: '2026-08-01T10:00:00Z',
        registeredTo: '2026-08-03T10:00:00Z',
        nickname: 'capitana panel',
        role: 'ADMINISTRATOR',
        status: 'ACTIVE',
        hasSanctionHistory: 'true',
      },
      ['acc-panel-admin'],
    ],
    [
      'fecha excluye coincidencia de otros filtros',
      { registeredFrom: '2026-08-03T10:00:00Z', role: 'ADMINISTRATOR', hasSanctionHistory: 'true' },
      [],
    ],
  ])('consulta y exportacion aplican %s', async (_case, query, ids) => {
    const listed = await request(app.getHttpServer())
      .get('/api/accounts')
      .query(query)
      .set('Authorization', bearer('token-admin'))
    const exported = await request(app.getHttpServer())
      .get('/api/accounts/export')
      .query(query)
      .set('Authorization', bearer('token-super'))
    expect(listed.status).toBe(200)
    expect(listed.body.items.map((item: { id: string }) => item.id)).toEqual(ids)
    expect(exported.status).toBe(200)
    expect(exported.body).toEqual(listed.body.items)
  })

  it.each([
    { registeredFrom: '2026-08-03T10:00:00Z', registeredTo: '2026-08-02T10:00:00Z' },
    { registeredFrom: '2026-08-02T12:00:00+01:00', registeredTo: '2026-08-02T10:00:00Z' },
    { registeredFrom: 'no-es-ISO' },
    { registeredTo: '2026-02-30T10:00:00Z' },
    { registeredFrom: '2026-02-29T10:00:00Z' },
    { registeredTo: '2026-13-01T00:00:00Z' },
    { registeredFrom: '2026-08-02T10:00:00' },
    { registeredTo: '2026-08-02' },
    { registeredFrom: '02/08/2026' },
    { registeredTo: '' },
    { registeredFrom: '2026-08-02T10:00:00.0001Z' },
    { registeredFrom: ['2026-08-02T10:00:00Z', '2026-08-03T10:00:00Z'] },
  ])('rechaza fechas invalidas o rango invertido %j con 400', async (query) => {
    for (const path of ['/api/accounts', '/api/accounts/export']) {
      const response = await request(app.getHttpServer())
        .get(path)
        .query(query)
        .set('Authorization', bearer('token-admin'))
      expect(response.status).toBe(400)
      expect(response.body).not.toHaveProperty('items')
    }
  })

  it('filtrar por fecha no cambia registeredAt, cuentas ni sanciones', async () => {
    const before = await request(app.getHttpServer())
      .get('/api/accounts')
      .set('Authorization', bearer('token-admin'))
    const accounts = app.get<AccountRepositoryPort>(ACCOUNT_REPOSITORY)
    const sanctions = app.get<InMemorySanctionRepository>(SANCTION_REPOSITORY)
    const readAccounts = () =>
      Promise.all(
        SEEDS.map(async (seed) =>
          (await accounts.findById(AccountId.create(seed.id)))?.toSnapshot(),
        ),
      )
    const snapshots = await readAccounts()
    const history = structuredClone(sanctions.findAll().map((sanction) => sanction.toSnapshot()))
    for (const path of ['/api/accounts', '/api/accounts/export']) {
      await request(app.getHttpServer())
        .get(path)
        .query({
          registeredFrom: '2026-08-02T10:00:00Z',
          registeredTo: '2026-08-04T10:00:00Z',
          hasSanctionHistory: 'true',
        })
        .set('Authorization', bearer('token-admin'))
        .expect(200)
    }
    const after = await request(app.getHttpServer())
      .get('/api/accounts')
      .set('Authorization', bearer('token-admin'))
    expect(after.body).toEqual(before.body)
    expect(await readAccounts()).toEqual(snapshots)
    expect(sanctions.findAll().map((sanction) => sanction.toSnapshot())).toEqual(history)
  })

  it('documenta ambos limites opcionales UTC en OpenAPI', () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build())
    for (const path of ['/api/accounts', '/api/accounts/export']) {
      for (const name of ['registeredFrom', 'registeredTo']) {
        expect(document.paths[path]?.get?.parameters).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name,
              in: 'query',
              required: false,
              schema: expect.objectContaining({ type: 'string', format: 'date-time' }),
            }),
          ]),
        )
      }
    }
  })

  it('publica el filtro booleano en OpenAPI para consulta y exportacion', () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build())
    for (const path of ['/api/accounts', '/api/accounts/export']) {
      expect(document.paths[path]?.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'hasSanctionHistory',
            in: 'query',
            required: false,
            schema: { type: 'boolean' },
          }),
        ]),
      )
    }
  })

  it.each([
    ['true', ['acc-panel-admin', 'acc-panel-banned', 'acc-panel-suspended']],
    ['false', ['acc-panel-super']],
  ])('filtra historial HU-42 con hasSanctionHistory=%s', async (value, ids) => {
    const response = await request(app.getHttpServer())
      .get(list(`?hasSanctionHistory=${value}`))
      .set('Authorization', bearer('token-admin'))
    expect(response.status).toBe(200)
    expect(response.body.items.map((item: { id: string }) => item.id)).toEqual(ids)
  })

  it.each([
    ['WARNING', 'id=acc-panel-admin', ['acc-panel-admin']],
    ['TEMPORARY_SUSPENSION vencida', 'id=acc-panel-suspended', ['acc-panel-suspended']],
    ['PERMANENT_BAN', 'id=acc-panel-banned', ['acc-panel-banned']],
    ['rol', 'role=MODERATOR', ['acc-panel-suspended']],
    ['estado', 'status=BANNED', ['acc-panel-banned']],
    [
      'multiples filtros',
      'nickname=capitana%20panel&role=ADMINISTRATOR&status=ACTIVE',
      ['acc-panel-admin'],
    ],
    ['sin coincidencias', 'email=panel.admin@nexus.test&status=BANNED', []],
  ])('combina historial con %s mediante AND', async (_label, query, ids) => {
    const response = await request(app.getHttpServer())
      .get(list(`?hasSanctionHistory=true&${query}`))
      .set('Authorization', bearer('token-super'))
    expect(response.status).toBe(200)
    expect(response.body.items.map((item: { id: string }) => item.id)).toEqual(ids)
  })

  it.each(['', '1', '0', 'TRUE', 'yes', 'false&hasSanctionHistory=true'])(
    'rechaza el historial invalido %s sin convertirlo silenciosamente',
    async (value) => {
      const response = await request(app.getHttpServer())
        .get(list(`?hasSanctionHistory=${value}`))
        .set('Authorization', bearer('token-admin'))
      expect(response.status).toBe(400)
      expect(response.body).not.toHaveProperty('items')
    },
  )

  it('mantiene las estadisticas existentes del resultado filtrado, incluido BANNED', async () => {
    const response = await request(app.getHttpServer())
      .get(list('?hasSanctionHistory=true'))
      .set('Authorization', bearer('token-admin'))
    expect(response.status).toBe(200)
    expect(response.body.statusCounts).toEqual({
      pendingVerification: 0,
      active: 1,
      suspended: 1,
      banned: 1,
    })
  })

  it('consultar y exportar historial no modifica cuentas ni sanciones', async () => {
    const accounts = app.get<AccountRepositoryPort>(ACCOUNT_REPOSITORY)
    const sanctions = app.get<InMemorySanctionRepository>(SANCTION_REPOSITORY)
    const readAccounts = () =>
      Promise.all(
        SEEDS.map(async (seed) =>
          (await accounts.findById(AccountId.create(seed.id)))?.toSnapshot(),
        ),
      )
    const beforeAccounts = await readAccounts()
    const beforeSanctions = structuredClone(
      sanctions.findAll().map((sanction) => sanction.toSnapshot()),
    )
    for (const value of ['true', 'false']) {
      const query = `?hasSanctionHistory=${value}&role=PLAYER`
      const listed = await request(app.getHttpServer())
        .get(list(query))
        .set('Authorization', bearer('token-admin'))
      const exported = await request(app.getHttpServer())
        .get(`/api/accounts/export${query}`)
        .set('Authorization', bearer('token-admin'))
      expect(listed.status).toBe(200)
      expect(exported.status).toBe(200)
      expect(exported.body).toEqual(listed.body.items)
    }
    expect(await readAccounts()).toEqual(beforeAccounts)
    expect(sanctions.findAll().map((sanction) => sanction.toSnapshot())).toEqual(beforeSanctions)
  })

  it.each(['/api/accounts', '/api/accounts/export'])(
    '%s no reactiva al actor cuya suspension ya vencio',
    async (path) => {
      const accounts = app.get<AccountRepositoryPort>(ACCOUNT_REPOSITORY)
      const sanctions = app.get<InMemorySanctionRepository>(SANCTION_REPOSITORY)
      const account = buildAccount({
        id: 'acc-expired-admin',
        subject: 'subject-expired-admin',
        email: 'expired.admin@nexus.test',
        displayName: 'Admin Expirado',
        firstNames: 'Admin',
        lastNames: 'Expirado',
        roles: [Role.Player, Role.Administrator],
        status: AccountStatus.Suspended,
      })
      await accounts.save(account)
      await sanctions.save(
        Sanction.create({
          id: 'sanction-expired-admin',
          targetAccountId: account.id.value,
          actorAccountId: 'acc-panel-super',
          type: SanctionType.TemporarySuspension,
          reason: 'Causal sintetica',
          createdAt: new Date('2020-01-01T00:00:00.000Z'),
          expiresAt: new Date('2020-01-02T00:00:00.000Z'),
        }),
      )
      try {
        const response = await request(app.getHttpServer())
          .get(path)
          .set('Authorization', bearer('token-expired-admin'))
        expect(response.status).toBe(200)
        expect((await accounts.findById(account.id))?.toSnapshot()).toEqual(account.toSnapshot())
      } finally {
        await accounts.deleteById(account.id)
      }
    },
  )

  it('permite a ADMINISTRATOR consultar el listado filtrado sin exponer datos sensibles', async () => {
    const response = await request(app.getHttpServer())
      .get(list('?role=ADMINISTRATOR&status=ACTIVE'))
      .set('Authorization', bearer('token-admin'))

    expect(response.status).toBe(200)
    expect(response.body.items).toHaveLength(1)
    expect(response.body.items[0]).toMatchObject({
      id: 'acc-panel-admin',
      email: 'panel.admin@nexus.test',
      displayName: 'Capitana Panel',
      firstNames: 'Ana Maria',
      lastNames: 'Vega',
      status: AccountStatus.Active,
      roles: [Role.Player, Role.Administrator],
      registeredAt: expect.any(String) as string,
    })
    expect(response.body.items[0]).not.toHaveProperty('subject')
    expect(response.body.items[0]).not.toHaveProperty('password')
    expect(response.body.items[0]).not.toHaveProperty('securityAnswers')
    expect(response.body.items[0]).not.toHaveProperty('avatarStorageKey')
    expect(response.body.items[0]).not.toHaveProperty('termsAccepted')
    expect(response.body.statusCounts).toEqual({
      pendingVerification: 0,
      active: 1,
      suspended: 0,
      banned: 0,
    })
    expect(response.body.statusCounts).toEqual({
      pendingVerification: 0,
      active: 1,
      suspended: 0,
      banned: 0,
    })
  })

  it('permite a SUPER_ADMINISTRATOR consultar una ruta ADMINISTRATOR', async () => {
    const response = await request(app.getHttpServer())
      .get(list('?nickname=raiz%20panel'))
      .set('Authorization', bearer('token-super'))

    expect(response.status).toBe(200)
    expect(response.body.items.map((item: { id: string }) => item.id)).toEqual(['acc-panel-super'])
  })

  it('combina filtros de busqueda y devuelve vacio como resultado valido', async () => {
    const byName = await request(app.getHttpServer())
      .get(list('?firstNames=ana%20maria&lastNames=vega'))
      .set('Authorization', bearer('token-admin'))

    expect(byName.status).toBe(200)
    expect(byName.body.items.map((item: { id: string }) => item.id)).toEqual(['acc-panel-admin'])

    const empty = await request(app.getHttpServer())
      .get(list('?id=acc-panel-inexistente'))
      .set('Authorization', bearer('token-admin'))

    expect(empty.status).toBe(200)
    expect(empty.body).toEqual({
      items: [],
      statusCounts: {
        pendingVerification: 0,
        active: 0,
        suspended: 0,
        banned: 0,
      },
    })
  })

  it.each([
    ['correo invalido', '?email=no-es-correo'],
    ['rol invalido', '?role=INVENTADO'],
    ['estado invalido', '?status=INVENTADO'],
  ])('rechaza %s con 400 sin payload administrativo', async (_case, query) => {
    const response = await request(app.getHttpServer())
      .get(list(query))
      .set('Authorization', bearer('token-admin'))

    expect(response.status).toBe(400)
    expect(response.body).not.toHaveProperty('items')
    expect(response.body).not.toHaveProperty('statusCounts')
  })

  it.each([
    ['MODERATOR', 'token-moderator'],
    ['PLAYER', 'token-player'],
  ])('rechaza a %s con 403 sin payload administrativo', async (_role, token) => {
    const response = await request(app.getHttpServer())
      .get(list('?hasSanctionHistory=true'))
      .set('Authorization', bearer(token))
      .set('x-user-role', 'ADMINISTRATOR')

    expect(response.status).toBe(403)
    expect(response.body).not.toHaveProperty('items')
    expect(response.body).not.toHaveProperty('statusCounts')
  })

  it('rechaza una peticion anonima con 401 sin payload administrativo', async () => {
    const response = await request(app.getHttpServer()).get(list())

    expect(response.status).toBe(401)
    expect(response.body).not.toHaveProperty('items')
    expect(response.body).not.toHaveProperty('statusCounts')
  })

  it.each([
    [AccountStatus.Suspended, SanctionType.TemporarySuspension],
    [AccountStatus.Banned, SanctionType.PermanentBan],
  ])('la consulta de solo lectura mantiene el rechazo del actor %s', async (status, type) => {
    const accounts = app.get<AccountRepositoryPort>(ACCOUNT_REPOSITORY)
    const sanctions = app.get<InMemorySanctionRepository>(SANCTION_REPOSITORY)
    const account = buildAccount({
      id: 'acc-expired-admin',
      subject: 'subject-expired-admin',
      email: 'expired.admin@nexus.test',
      displayName: 'Admin Expirado',
      firstNames: 'Admin',
      lastNames: 'Expirado',
      roles: [Role.Player, Role.Administrator],
      status,
    })
    await accounts.save(account)
    await sanctions.save(
      Sanction.create({
        id: 'sanction-expired-admin',
        targetAccountId: account.id.value,
        actorAccountId: 'acc-panel-super',
        type,
        reason: 'Causal sintetica',
        createdAt: new Date('2020-01-01T00:00:00.000Z'),
        expiresAt:
          type === SanctionType.TemporarySuspension ? new Date('2100-01-01T00:00:00.000Z') : null,
      }),
    )
    try {
      for (const path of ['/api/accounts', '/api/accounts/export']) {
        const response = await request(app.getHttpServer())
          .get(`${path}?hasSanctionHistory=true`)
          .set('Authorization', bearer('token-expired-admin'))
        expect(response.status).toBe(403)
        expect(response.body).not.toHaveProperty('items')
      }
      expect((await accounts.findById(account.id))?.toSnapshot()).toEqual(account.toSnapshot())
    } finally {
      await accounts.deleteById(account.id)
    }
  })
})
