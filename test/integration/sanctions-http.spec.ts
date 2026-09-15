import 'reflect-metadata'

import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../../src/infrastructure/bootstrap/app.module'
import { Account } from '../../src/domain/entities/Account'
import { AccountStatus } from '../../src/domain/entities/AccountStatus'
import { Role } from '../../src/domain/entities/Role'
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
  type NotificationRequest,
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

interface AccountSeed {
  readonly id: string
  readonly subject: string
  readonly email: string
  readonly displayName: string
  readonly roles: readonly Role[]
}

const IDENTITIES: Readonly<Record<string, VerifiedIdentity>> = {
  'token-player': {
    subject: 'subject-player',
    roles: new Set([Role.Player]),
    jti: null,
    expiresAt: null,
  },

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

  'token-super': {
    subject: 'subject-super',
    roles: new Set([Role.SuperAdministrator]),
    jti: null,
    expiresAt: null,
  },
}

const ACTORS: readonly AccountSeed[] = [
  {
    id: 'actor-player',
    subject: 'subject-player',
    email: 'player@nexus.test',
    displayName: 'Jugador Pruebas',
    roles: [Role.Player],
  },
  {
    id: 'actor-moderator',
    subject: 'subject-moderator',
    email: 'moderator@nexus.test',
    displayName: 'Moderador Pruebas',
    roles: [Role.Player, Role.Moderator],
  },
  {
    id: 'actor-admin',
    subject: 'subject-admin',
    email: 'admin@nexus.test',
    displayName: 'Administrador Pruebas',
    roles: [Role.Player, Role.Administrator],
  },
  {
    id: 'actor-super',
    subject: 'subject-super',
    email: 'super@nexus.test',
    displayName: 'Super Admin Pruebas',
    roles: [Role.SuperAdministrator],
  },
]

const TARGETS: readonly AccountSeed[] = [
  {
    id: 'target-warning',
    subject: 'subject-target-warning',
    email: 'warning@nexus.test',
    displayName: 'Objetivo Warning',
    roles: [Role.Player],
  },
  {
    id: 'target-suspension',
    subject: 'subject-target-suspension',
    email: 'suspension@nexus.test',
    displayName: 'Objetivo Suspension',
    roles: [Role.Player],
  },
  {
    id: 'target-admin-ban',
    subject: 'subject-target-admin-ban',
    email: 'admin.ban@nexus.test',
    displayName: 'Objetivo Admin Ban',
    roles: [Role.Player],
  },
  {
    id: 'target-super-ban',
    subject: 'subject-target-super-ban',
    email: 'super.ban@nexus.test',
    displayName: 'Objetivo Super Ban',
    roles: [Role.Player],
  },
  {
    id: 'target-rejected',
    subject: 'subject-target-rejected',
    email: 'rejected@nexus.test',
    displayName: 'Objetivo Rechazado',
    roles: [Role.Player],
  },
  {
    id: 'target-player-rejected',
    subject: 'subject-target-player-rejected',
    email: 'player.rejected@nexus.test',
    displayName: 'Objetivo Player',
    roles: [Role.Player],
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
    firstNames: PersonName.create('Usuario', 'Los nombres'),
    lastNames: PersonName.create('Pruebas', 'Los apellidos'),
    termsAccepted: true,
    avatar: defaultAvatarMetadata(seed.id),
    status: AccountStatus.Active,
    roles: seed.roles,
  })

describe('HU-42.5 - Aceptacion e integracion de sanciones', () => {
  let app: INestApplication
  let accounts: AccountRepositoryPort
  let previousEnv: Record<string, string | undefined>

  const requestedNotifications: NotificationRequest[] = []

  const notifications: NotificationRequestPort = {
    request: (notification: NotificationRequest): Promise<void> => {
      requestedNotifications.push(notification)

      return Promise.resolve()
    },
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
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )

    await app.init()

    accounts = app.get<AccountRepositoryPort>(ACCOUNT_REPOSITORY)

    for (const seed of [...ACTORS, ...TARGETS]) {
      await accounts.save(buildAccount(seed))
    }
  })

  beforeEach(() => {
    requestedNotifications.length = 0
  })

  afterAll(async () => {
    await app.close()

    for (const [key, value] of Object.entries(previousEnv)) {
      process.env[key] = value ?? ''
    }
  })

  const bearer = (token: string): string => `Bearer ${token}`

  const sanctionUrl = (accountId: string): string => `/api/accounts/${accountId}/sanctions`

  it('CA-01: permite a Moderador aplicar una advertencia sin restringir acceso', async () => {
    const response = await request(app.getHttpServer())
      .post(sanctionUrl('target-warning'))
      .set('Authorization', bearer('token-moderator'))
      .send({
        type: SanctionType.Warning,
        reason: 'Conducta ofensiva reiterada.',
      })

    expect(response.status).toBe(201)

    expect(response.body).toMatchObject({
      targetAccountId: 'target-warning',
      actorAccountId: 'actor-moderator',
      type: SanctionType.Warning,
      reason: 'Conducta ofensiva reiterada.',
      expiresAt: null,
    })

    expect(response.body.id).toEqual(expect.any(String))
    expect(response.body.createdAt).toEqual(expect.any(String))
    expect(response.body.appealDeadline).toEqual(expect.any(String))

    const target = await accounts.findById(AccountId.create('target-warning'))

    expect(target?.currentStatus).toBe(AccountStatus.Active)
    expect(target?.canAuthenticate).toBe(true)
  })

  it('CA-02: permite a Moderador aplicar suspension temporal y restringe el acceso', async () => {
    const response = await request(app.getHttpServer())
      .post(sanctionUrl('target-suspension'))
      .set('Authorization', bearer('token-moderator'))
      .send({
        type: SanctionType.TemporarySuspension,
        reason: 'Incumplimiento reiterado.',
        suspensionDurationMinutes: 60,
      })

    expect(response.status).toBe(201)

    expect(response.body).toMatchObject({
      targetAccountId: 'target-suspension',
      actorAccountId: 'actor-moderator',
      type: SanctionType.TemporarySuspension,
      reason: 'Incumplimiento reiterado.',
    })

    expect(response.body.expiresAt).toEqual(expect.any(String))

    const target = await accounts.findById(AccountId.create('target-suspension'))

    expect(target?.currentStatus).toBe(AccountStatus.Suspended)
    expect(target?.canAuthenticate).toBe(false)
  })

  it('CA-03: permite a Administrador aplicar baneo definitivo', async () => {
    const response = await request(app.getHttpServer())
      .post(sanctionUrl('target-admin-ban'))
      .set('Authorization', bearer('token-admin'))
      .send({
        type: SanctionType.PermanentBan,
        reason: 'Violacion grave y reiterada.',
      })

    expect(response.status).toBe(201)

    expect(response.body).toMatchObject({
      targetAccountId: 'target-admin-ban',
      actorAccountId: 'actor-admin',
      type: SanctionType.PermanentBan,
      reason: 'Violacion grave y reiterada.',
      expiresAt: null,
    })

    const target = await accounts.findById(AccountId.create('target-admin-ban'))

    expect(target?.currentStatus).toBe(AccountStatus.Banned)
    expect(target?.canAuthenticate).toBe(false)
  })

  it('CA-03: permite a Super Administrador aplicar baneo definitivo', async () => {
    const response = await request(app.getHttpServer())
      .post(sanctionUrl('target-super-ban'))
      .set('Authorization', bearer('token-super'))
      .send({
        type: SanctionType.PermanentBan,
        reason: 'Violacion critica de las reglas.',
      })

    expect(response.status).toBe(201)

    expect(response.body).toMatchObject({
      targetAccountId: 'target-super-ban',
      actorAccountId: 'actor-super',
      type: SanctionType.PermanentBan,
      expiresAt: null,
    })

    const target = await accounts.findById(AccountId.create('target-super-ban'))

    expect(target?.currentStatus).toBe(AccountStatus.Banned)
    expect(target?.canAuthenticate).toBe(false)
  })

  it('rechaza que Moderador aplique baneo definitivo sin dejar cambios parciales', async () => {
    const response = await request(app.getHttpServer())
      .post(sanctionUrl('target-rejected'))
      .set('Authorization', bearer('token-moderator'))
      .send({
        type: SanctionType.PermanentBan,
        reason: 'Intento de baneo no autorizado.',
      })

    expect(response.status).toBe(403)

    const target = await accounts.findById(AccountId.create('target-rejected'))

    expect(target?.currentStatus).toBe(AccountStatus.Active)
    expect(target?.canAuthenticate).toBe(true)

    expect(requestedNotifications).toHaveLength(0)
  })

  it('rechaza que un Jugador aplique sanciones', async () => {
    const response = await request(app.getHttpServer())
      .post(sanctionUrl('target-player-rejected'))
      .set('Authorization', bearer('token-player'))
      .send({
        type: SanctionType.Warning,
        reason: 'Intento no autorizado.',
      })

    expect(response.status).toBe(403)

    const target = await accounts.findById(AccountId.create('target-player-rejected'))

    expect(target?.currentStatus).toBe(AccountStatus.Active)
    expect(target?.canAuthenticate).toBe(true)

    expect(requestedNotifications).toHaveLength(0)
  })

  it('integra RF-55 solicitando una notificacion asociada a la sancion valida', async () => {
    const targetId = 'target-notification'

    await accounts.save(
      buildAccount({
        id: targetId,
        subject: 'subject-target-notification',
        email: 'notification@nexus.test',
        displayName: 'Objetivo Notificacion',
        roles: [Role.Player],
      }),
    )

    const response = await request(app.getHttpServer())
      .post(sanctionUrl(targetId))
      .set('Authorization', bearer('token-moderator'))
      .send({
        type: SanctionType.Warning,
        reason: 'Prueba de integracion con RF-55.',
      })

    expect(response.status).toBe(201)
    expect(requestedNotifications).toHaveLength(1)

    expect(requestedNotifications[0]).toMatchObject({
      recipient: 'notification@nexus.test',
      templateId: 'account-sanction-applied',
      variables: {
        sanctionId: response.body.id as string,
        sanctionType: SanctionType.Warning,
        reason: 'Prueba de integracion con RF-55.',
        appealWindowDays: 30,
      },
    })
  })

  it('habilita apelacion durante 30 dias y expone la fecha limite', async () => {
    const targetId = 'target-appeal'

    await accounts.save(
      buildAccount({
        id: targetId,
        subject: 'subject-target-appeal',
        email: 'appeal@nexus.test',
        displayName: 'Objetivo Apelacion',
        roles: [Role.Player],
      }),
    )

    const response = await request(app.getHttpServer())
      .post(sanctionUrl(targetId))
      .set('Authorization', bearer('token-moderator'))
      .send({
        type: SanctionType.Warning,
        reason: 'Validar ventana de apelacion.',
      })

    expect(response.status).toBe(201)

    const createdAt = new Date(response.body.createdAt as string)

    const appealDeadline = new Date(response.body.appealDeadline as string)

    const thirtyDaysInMs = 30 * 24 * 60 * 60 * 1000

    expect(appealDeadline.getTime() - createdAt.getTime()).toBe(thirtyDaysInMs)

    expect(requestedNotifications[0]?.variables).toMatchObject({
      appealDeadline: appealDeadline.toISOString(),
      appealWindowDays: 30,
    })
  })

  it('rechaza payload invalido sin modificar la cuenta ni notificar', async () => {
    const targetId = 'target-invalid-payload'

    await accounts.save(
      buildAccount({
        id: targetId,
        subject: 'subject-target-invalid',
        email: 'invalid@nexus.test',
        displayName: 'Objetivo Invalido',
        roles: [Role.Player],
      }),
    )

    const response = await request(app.getHttpServer())
      .post(sanctionUrl(targetId))
      .set('Authorization', bearer('token-moderator'))
      .send({
        type: SanctionType.TemporarySuspension,
        reason: 'Suspension sin duracion.',
      })

    expect(response.status).toBe(400)

    const target = await accounts.findById(AccountId.create(targetId))

    expect(target?.currentStatus).toBe(AccountStatus.Active)
    expect(target?.canAuthenticate).toBe(true)

    expect(requestedNotifications).toHaveLength(0)
  })
})
