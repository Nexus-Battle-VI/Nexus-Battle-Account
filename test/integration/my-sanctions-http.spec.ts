import 'reflect-metadata'

import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../../src/infrastructure/bootstrap/app.module'
import { Account } from '../../src/domain/entities/Account'
import { AccountStatus } from '../../src/domain/entities/AccountStatus'
import { Role } from '../../src/domain/entities/Role'
import { SanctionReasonCode } from '../../src/domain/entities/SanctionReasonCode'
import { SanctionType } from '../../src/domain/entities/SanctionType'
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
import {
  ACCOUNT_REPOSITORY,
  type AccountRepositoryPort,
} from '../../src/application/ports/AccountRepositoryPort'
import {
  NOTIFICATION_REQUEST,
  type NotificationRequestPort,
} from '../../src/application/ports/NotificationRequestPort'
import { IDENTITY_SIGN_UP } from '../../src/application/ports/IdentitySignUpPort'
import { ROLE_DIRECTORY } from '../../src/application/ports/RoleDirectoryPort'
import { MFA_STATUS } from '../../src/application/ports/MfaStatusPort'
import { SESSION_REVOCATION } from '../../src/application/ports/SessionRevocationPort'
import { InMemoryIdentitySignUp } from '../../src/adapters/outbound/identity/InMemoryIdentitySignUp'
import { InMemoryRoleDirectory } from '../../src/adapters/outbound/identity/InMemoryRoleDirectory'
import { InMemoryMfaStatus } from '../../src/adapters/outbound/identity/InMemoryMfaStatus'
import { InMemorySessionRevocation } from '../../src/adapters/outbound/identity/InMemorySessionRevocation'
import { defaultAvatarMetadata } from '../support/account-factory'

const IDENTITIES: Readonly<Record<string, VerifiedIdentity>> = {
  'token-moderator': {
    subject: 'subject-moderator',
    roles: new Set([Role.Player, Role.Moderator]),
    jti: null,
    expiresAt: null,
  },
  'token-admin': {
    subject: 'subject-admin',
    roles: new Set([Role.Player, Role.Administrator]),
    jti: null,
    expiresAt: null,
  },
  'token-target-suspended': {
    subject: 'subject-target-suspended',
    roles: new Set([Role.Player]),
    jti: null,
    expiresAt: null,
  },
  'token-target-banned': {
    subject: 'subject-target-banned',
    roles: new Set([Role.Player]),
    jti: null,
    expiresAt: null,
  },
  'token-target-active': {
    subject: 'subject-target-active',
    roles: new Set([Role.Player]),
    jti: null,
    expiresAt: null,
  },
}

const stubVerifier: TokenVerifierPort = {
  verify: (token: string): Promise<VerifiedIdentity> => {
    const identity = IDENTITIES[token]

    return identity === undefined
      ? Promise.reject(new TokenVerificationError())
      : Promise.resolve(identity)
  },
}

const buildAccount = (params: {
  id: string
  subject: string
  email: string
  roles: readonly Role[]
}): Account =>
  Account.restore({
    id: AccountId.create(params.id),
    subject: params.subject,
    email: EmailAddress.create(params.email),
    displayName: DisplayName.create(`Objetivo ${params.id}`),
    firstNames: PersonName.create('Usuario', 'Los nombres'),
    lastNames: PersonName.create('Pruebas', 'Los apellidos'),
    termsAccepted: true,
    avatar: defaultAvatarMetadata(params.id),
    status: AccountStatus.Active,
    roles: params.roles,
  })

describe('HU-42 - Autoservicio de sanciones del propio titular (contador visible, §7.3.2)', () => {
  let app: INestApplication
  let accounts: AccountRepositoryPort
  let previousEnv: Record<string, string | undefined>

  const notifications: NotificationRequestPort = {
    request: (): Promise<void> => Promise.resolve(),
  }

  beforeAll(async () => {
    previousEnv = {
      AUTH_MODE: process.env.AUTH_MODE,
      COGNITO_USER_POOL_ID: process.env.COGNITO_USER_POOL_ID,
      COGNITO_CLIENT_ID: process.env.COGNITO_CLIENT_ID,
    }

    process.env.AUTH_MODE = 'jwt'
    process.env.COGNITO_USER_POOL_ID = 'us-east-1_pruebas'
    process.env.COGNITO_CLIENT_ID = 'cliente-de-pruebas'

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(TOKEN_VERIFIER)
      .useValue(stubVerifier)
      .overrideProvider(NOTIFICATION_REQUEST)
      .useValue(notifications)
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

    accounts = app.get<AccountRepositoryPort>(ACCOUNT_REPOSITORY)

    await accounts.save(
      buildAccount({
        id: 'actor-moderator',
        subject: 'subject-moderator',
        email: 'moderator@nexus.test',
        roles: [Role.Player, Role.Moderator],
      }),
    )
    await accounts.save(
      buildAccount({
        id: 'actor-admin',
        subject: 'subject-admin',
        email: 'admin@nexus.test',
        roles: [Role.Player, Role.Administrator],
      }),
    )
    await accounts.save(
      buildAccount({
        id: 'target-suspended',
        subject: 'subject-target-suspended',
        email: 'suspended@nexus.test',
        roles: [Role.Player],
      }),
    )
    await accounts.save(
      buildAccount({
        id: 'target-banned',
        subject: 'subject-target-banned',
        email: 'banned@nexus.test',
        roles: [Role.Player],
      }),
    )
    await accounts.save(
      buildAccount({
        id: 'target-active',
        subject: 'subject-target-active',
        email: 'active@nexus.test',
        roles: [Role.Player],
      }),
    )

    await request(app.getHttpServer())
      .post('/api/accounts/target-suspended/sanctions')
      .set('Authorization', 'Bearer token-moderator')
      .send({
        type: SanctionType.TemporarySuspension,
        reason: 'Suspension de prueba.',
        reasonCode: SanctionReasonCode.Other,
        suspensionDurationMinutes: 60,
      })
      .expect(201)

    await request(app.getHttpServer())
      .post('/api/accounts/target-banned/sanctions')
      .set('Authorization', 'Bearer token-admin')
      .send({
        type: SanctionType.PermanentBan,
        reason: 'Baneo de prueba.',
        reasonCode: SanctionReasonCode.Harassment,
      })
      .expect(201)
  })

  afterAll(async () => {
    await app.close()

    for (const [key, value] of Object.entries(previousEnv)) {
      process.env[key] = value ?? ''
    }
  })

  it('permite a una cuenta SUSPENDIDA consultar su propio estado con el tiempo restante visible', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/accounts/me/sanctions/active')
      .set('Authorization', 'Bearer token-target-suspended')

    expect(response.status).toBe(200)
    expect(response.body.hasActiveSanctions).toBe(true)
    expect(response.body.sanctions).toHaveLength(1)
    expect(response.body.sanctions[0]).toMatchObject({
      type: SanctionType.TemporarySuspension,
      reason: 'Suspension de prueba.',
    })
    expect(response.body.remainingSeconds).toEqual(expect.any(Number))
    expect(response.body.remainingSeconds).toBeGreaterThan(0)
    expect(response.body.remainingSeconds).toBeLessThanOrEqual(3600)
  })

  it('permite a una cuenta BANEADA consultar su propio estado, sin tiempo restante', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/accounts/me/sanctions/active')
      .set('Authorization', 'Bearer token-target-banned')

    expect(response.status).toBe(200)
    expect(response.body.hasActiveSanctions).toBe(true)
    expect(response.body.sanctions).toHaveLength(1)
    expect(response.body.sanctions[0]).toMatchObject({
      type: SanctionType.PermanentBan,
      reasonCode: SanctionReasonCode.Harassment,
    })
    expect(response.body.remainingSeconds).toBeNull()
  })

  it('una cuenta activa sin sanciones no tiene sanciones activas', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/accounts/me/sanctions/active')
      .set('Authorization', 'Bearer token-target-active')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      hasActiveSanctions: false,
      sanctions: [],
      remainingSeconds: null,
    })
  })

  it('rechaza la consulta sin testimonio', async () => {
    const response = await request(app.getHttpServer()).get('/api/accounts/me/sanctions/active')

    expect(response.status).toBe(401)
  })
})
