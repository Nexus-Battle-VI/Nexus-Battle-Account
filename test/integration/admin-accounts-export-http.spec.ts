import 'reflect-metadata'

import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
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
  'token-player': { subject: 'subject-player-caller', roles: new Set([Role.Player]) },
  'token-moderator': {
    subject: 'subject-moderator-caller',
    roles: new Set([Role.Player, Role.Moderator]),
  },
  'token-admin': {
    subject: 'subject-admin-caller',
    roles: new Set([Role.Player, Role.Administrator]),
  },
  'token-super': {
    subject: 'subject-super-caller',
    roles: new Set([Role.SuperAdministrator]),
  },
}

const SEEDS: readonly AccountSeed[] = [
  {
    id: 'acc-export-panel-admin',
    subject: 'subject-export-panel-admin',
    email: 'export.panel.admin@nexus.test',
    displayName: 'Capitana Panel Export',
    firstNames: 'Ana Maria',
    lastNames: 'Vega',
    status: AccountStatus.Active,
    roles: [Role.Player, Role.Administrator],
  },
  {
    id: 'acc-export-panel-super',
    subject: 'subject-export-panel-super',
    email: 'export.panel.super@nexus.test',
    displayName: 'Raiz Panel Export',
    firstNames: 'Sofia',
    lastNames: 'Vega',
    status: AccountStatus.Active,
    roles: [Role.SuperAdministrator],
  },
  {
    id: 'acc-export-panel-suspended',
    subject: 'subject-export-panel-suspended',
    email: 'export.panel.suspended@nexus.test',
    displayName: 'Moderadora Panel Export',
    firstNames: 'Bruno',
    lastNames: 'Rojas',
    status: AccountStatus.Suspended,
    roles: [Role.Player, Role.Moderator],
  },
]

const EXPORT_FIELDS = [
  'id',
  'email',
  'displayName',
  'firstNames',
  'lastNames',
  'status',
  'roles',
  'registeredAt',
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

const parseJsonFile = (response: { readonly text: string; readonly body: unknown }) => {
  const parsed = response.text.length > 0 ? (JSON.parse(response.text) as unknown) : response.body

  if (!Array.isArray(parsed)) {
    throw new Error('La exportacion debe ser un arreglo JSON.')
  }

  return parsed as readonly Record<string, unknown>[]
}

describe('Exportacion administrativa de cuentas HU-44.4', () => {
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

    for (const seed of SEEDS) {
      await accounts.save(buildAccount(seed))
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
  const exportUsers = (query = ''): string => `/api/accounts/export${query}`

  it('permite a ADMINISTRATOR descargar un archivo con los mismos IDs del panel filtrado', async () => {
    const query = '?role=ADMINISTRATOR&status=ACTIVE'
    const listed = await request(app.getHttpServer())
      .get(list(query))
      .set('Authorization', bearer('token-admin'))

    const exported = await request(app.getHttpServer())
      .get(exportUsers(query))
      .set('Authorization', bearer('token-admin'))

    const listedItems = (listed.body as { readonly items: readonly Record<string, unknown>[] })
      .items
    const exportedItems = parseJsonFile(exported)

    expect(exported.status).toBe(200)
    expect(exported.headers['content-type']).toMatch(/^application\/json; charset=utf-8\b/u)
    expect(exported.headers['content-disposition']).toBe(
      'attachment; filename="nexus-battles-users.json"',
    )
    expect(exportedItems).toEqual(listedItems)
    expect(exportedItems.map((item) => item.id)).toEqual(['acc-export-panel-admin'])
    expect(Object.keys(exportedItems[0] ?? {})).toEqual(EXPORT_FIELDS)
    expect(exportedItems[0]).not.toHaveProperty('subject')
    expect(exportedItems[0]).not.toHaveProperty('password')
    expect(exportedItems[0]).not.toHaveProperty('securityAnswers')
    expect(exportedItems[0]).not.toHaveProperty('avatarStorageKey')
    expect(exportedItems[0]).not.toHaveProperty('termsAccepted')
  })

  it('permite a SUPER_ADMINISTRATOR descargar una ruta ADMINISTRATOR', async () => {
    const response = await request(app.getHttpServer())
      .get(exportUsers('?nickname=raiz%20panel%20export'))
      .set('Authorization', bearer('token-super'))

    expect(response.status).toBe(200)
    expect(parseJsonFile(response).map((item) => item.id)).toEqual(['acc-export-panel-super'])
  })

  it('aplica busqueda, combinacion AND y resultado vacio como archivo valido', async () => {
    const byName = await request(app.getHttpServer())
      .get(exportUsers('?firstNames=ana%20maria&lastNames=vega'))
      .set('Authorization', bearer('token-admin'))

    expect(byName.status).toBe(200)
    expect(parseJsonFile(byName).map((item) => item.id)).toEqual(['acc-export-panel-admin'])

    const empty = await request(app.getHttpServer())
      .get(exportUsers('?role=SUPER_ADMINISTRATOR&status=SUSPENDED'))
      .set('Authorization', bearer('token-admin'))

    expect(empty.status).toBe(200)
    expect(parseJsonFile(empty)).toEqual([])
  })

  it.each([
    ['MODERATOR', 'token-moderator'],
    ['PLAYER', 'token-player'],
  ])('rechaza a %s con 403 sin contenido exportable', async (_role, token) => {
    const response = await request(app.getHttpServer())
      .get(exportUsers())
      .set('Authorization', bearer(token))

    expect(response.status).toBe(403)
    expect(response.headers['content-disposition']).toBeUndefined()
    expect(response.text).not.toContain('acc-export-panel')
  })

  it('rechaza una peticion anonima con 401 sin contenido exportable', async () => {
    const response = await request(app.getHttpServer()).get(exportUsers())

    expect(response.status).toBe(401)
    expect(response.headers['content-disposition']).toBeUndefined()
    expect(response.text).not.toContain('acc-export-panel')
  })
})
