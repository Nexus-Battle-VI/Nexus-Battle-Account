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
import { AUTHENTICATION_PROVIDER } from '../../src/application/ports/AuthenticationProviderPort'
import { NOTIFICATION_REQUEST } from '../../src/application/ports/NotificationRequestPort'
import { IDENTITY_SIGN_UP } from '../../src/application/ports/IdentitySignUpPort'
import { ROLE_DIRECTORY } from '../../src/application/ports/RoleDirectoryPort'
import { MFA_STATUS } from '../../src/application/ports/MfaStatusPort'
import { SESSION_REVOCATION } from '../../src/application/ports/SessionRevocationPort'
import { InMemoryIdentitySignUp } from '../../src/adapters/outbound/identity/InMemoryIdentitySignUp'
import { InMemoryRoleDirectory } from '../../src/adapters/outbound/identity/InMemoryRoleDirectory'
import { InMemoryMfaStatus } from '../../src/adapters/outbound/identity/InMemoryMfaStatus'
import { InMemorySessionRevocation } from '../../src/adapters/outbound/identity/InMemorySessionRevocation'
import type { FakeAuthenticationProvider } from '../../src/adapters/outbound/identity/FakeAuthenticationProvider'
import { defaultAvatarMetadata } from '../support/account-factory'

const TARGET_PASSWORD = 'ClaveDePrueba123!'

const IDENTITIES: Readonly<Record<string, VerifiedIdentity>> = {
  'token-admin': {
    subject: 'subject-admin',
    roles: new Set([Role.Player, Role.Administrator]),
    jti: null,
    expiresAt: null,
  },
  'token-moderator': {
    subject: 'subject-moderator',
    roles: new Set([Role.Player, Role.Moderator]),
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
    displayName: DisplayName.create(`Cuenta ${params.id}`),
    firstNames: PersonName.create('Usuario', 'Los nombres'),
    lastNames: PersonName.create('Pruebas', 'Los apellidos'),
    termsAccepted: true,
    avatar: defaultAvatarMetadata(params.id),
    status: AccountStatus.Active,
    roles: params.roles,
  })

describe('HU-42 - Apelaciones de sanciones (identidad restringida, §6/§7.3.2)', () => {
  let app: INestApplication
  let accounts: AccountRepositoryPort
  let authProvider: FakeAuthenticationProvider
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
      .overrideProvider(NOTIFICATION_REQUEST)
      .useValue({ request: (): Promise<void> => Promise.resolve() })
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
    authProvider = app.get(AUTHENTICATION_PROVIDER)

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
        id: 'actor-moderator',
        subject: 'subject-moderator',
        email: 'moderator@nexus.test',
        roles: [Role.Player, Role.Moderator],
      }),
    )
  })

  afterAll(async () => {
    await app.close()

    for (const [key, value] of Object.entries(previousEnv)) {
      process.env[key] = value ?? ''
    }
  })

  const seedBannedTarget = async (id: string, email: string): Promise<void> => {
    await accounts.save(
      buildAccount({ id, subject: `subject-${id}`, email, roles: [Role.Player] }),
    )
    authProvider.seed({ email, password: TARGET_PASSWORD })
  }

  it('flujo completo: baneo -> apelacion con identidad restringida -> revision -> OVERTURNED levanta el baneo', async () => {
    const targetId = 'target-full-flow'
    const targetEmail = 'full.flow@nexus.test'
    await seedBannedTarget(targetId, targetEmail)

    const sanctionResponse = await request(app.getHttpServer())
      .post(`/api/accounts/${targetId}/sanctions`)
      .set('Authorization', 'Bearer token-admin')
      .send({
        type: SanctionType.PermanentBan,
        reason: 'Fraude confirmado en subastas.',
        reasonCode: SanctionReasonCode.FraudOrManipulation,
      })

    expect(sanctionResponse.status).toBe(201)
    const sanctionId: string = sanctionResponse.body.id

    const target = await accounts.findById(AccountId.create(targetId))
    expect(target?.currentStatus).toBe(AccountStatus.Banned)

    // El login normal esta cerrado: una cuenta baneada no puede autenticar.
    const normalLogin = await request(app.getHttpServer())
      .post('/api/sessions')
      .send({ identifier: targetEmail, password: TARGET_PASSWORD })
    expect(normalLogin.status).not.toBe(201)

    // Identidad restringida: la misma contrasena, un proposito distinto.
    const appealAuth = await request(app.getHttpServer())
      .post('/api/accounts/appeals/auth')
      .send({ identifier: targetEmail, password: TARGET_PASSWORD })

    expect(appealAuth.status).toBe(200)
    const appealToken: string = appealAuth.body.appealToken
    expect(typeof appealToken).toBe('string')

    const submitted = await request(app.getHttpServer())
      .post('/api/accounts/me/appeals')
      .set('Authorization', `Bearer ${appealToken}`)
      .send({ sanctionId, statement: 'No cometi fraude, adjunto evidencia del caso.' })

    expect(submitted.status).toBe(201)
    expect(submitted.body).toMatchObject({ sanctionId, accountId: targetId, status: 'SUBMITTED' })
    const appealId: string = submitted.body.id

    // El token de apelacion NUNCA abre otras rutas protegidas del servicio.
    const forbiddenUse = await request(app.getHttpServer())
      .get('/api/accounts/me')
      .set('Authorization', `Bearer ${appealToken}`)
    expect(forbiddenUse.status).toBe(401)

    const myStatus = await request(app.getHttpServer())
      .get('/api/accounts/me/appeals')
      .set('Authorization', `Bearer ${appealToken}`)
    expect(myStatus.status).toBe(200)
    expect(myStatus.body).toHaveLength(1)
    expect(myStatus.body[0]).toMatchObject({ id: appealId, status: 'SUBMITTED' })

    const pending = await request(app.getHttpServer())
      .get('/api/accounts/appeals')
      .set('Authorization', 'Bearer token-admin')
    expect(pending.status).toBe(200)
    expect(pending.body.some((item: { id: string }) => item.id === appealId)).toBe(true)

    // Un Moderador no tiene autoridad sobre la apelacion de un baneo.
    const moderatorAttempt = await request(app.getHttpServer())
      .post(`/api/accounts/appeals/${appealId}/resolution`)
      .set('Authorization', 'Bearer token-moderator')
      .send({ decision: 'OVERTURNED', notes: 'Intento sin autoridad.' })
    expect(moderatorAttempt.status).toBe(403)

    const resolved = await request(app.getHttpServer())
      .post(`/api/accounts/appeals/${appealId}/resolution`)
      .set('Authorization', 'Bearer token-admin')
      .send({ decision: 'OVERTURNED', notes: 'La evidencia aportada desvirtua la causal.' })

    expect(resolved.status).toBe(200)
    expect(resolved.body).toMatchObject({ status: 'RESOLVED', decision: 'OVERTURNED' })

    const reinstated = await accounts.findById(AccountId.create(targetId))
    expect(reinstated?.currentStatus).toBe(AccountStatus.Active)

    const secondResolution = await request(app.getHttpServer())
      .post(`/api/accounts/appeals/${appealId}/resolution`)
      .set('Authorization', 'Bearer token-admin')
      .send({ decision: 'UPHELD', notes: 'Segundo intento sobre una apelacion ya resuelta.' })
    expect(secondResolution.status).toBe(400)
  })

  it('rechaza presentar apelacion con un token de apelacion invalido', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/accounts/me/appeals')
      .set('Authorization', 'Bearer token-invalido')
      .send({ sanctionId: 'cualquiera', statement: 'Justificacion.' })

    expect(response.status).toBe(401)
  })

  it('rechaza la autenticacion de apelacion con contrasena incorrecta', async () => {
    const targetId = 'target-wrong-password'
    const targetEmail = 'wrong.password@nexus.test'
    await seedBannedTarget(targetId, targetEmail)

    const response = await request(app.getHttpServer())
      .post('/api/accounts/appeals/auth')
      .send({ identifier: targetEmail, password: 'incorrecta' })

    expect(response.status).toBe(401)
  })
})
