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
    })
    expect(response.body.statusCounts).not.toHaveProperty('banned')
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
      },
    })
  })

  it.each([
    ['MODERATOR', 'token-moderator'],
    ['PLAYER', 'token-player'],
  ])('rechaza a %s con 403 sin payload administrativo', async (_role, token) => {
    const response = await request(app.getHttpServer())
      .get(list())
      .set('Authorization', bearer(token))

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
})
