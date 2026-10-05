import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Kysely } from 'kysely'
import request from 'supertest'

import { AppModule, DATABASE } from '../../src/infrastructure/bootstrap/app.module'
import { createDatabase, migrateToLatest } from '../../src/infrastructure/persistence/database'
import type { Database } from '../../src/adapters/outbound/persistence/schema'
import { LocalAvatarStorage } from '../../src/adapters/outbound/storage/LocalAvatarStorage'
import { signInternalRequest } from '../../src/adapters/inbound/http/auth/internal-signature'
import {
  ACCOUNT_REPOSITORY,
  type AccountRepositoryPort,
} from '../../src/application/ports/AccountRepositoryPort'
import { AVATAR_STORAGE } from '../../src/application/ports/AvatarStoragePort'
import {
  TOKEN_VERIFIER,
  TokenVerificationError,
} from '../../src/application/ports/TokenVerifierPort'
import { Role } from '../../src/domain/entities/Role'
import { buildAccount, buildActiveAccount } from '../support/account-factory'
import { startTestPostgres, type TestPostgres } from './postgres-runtime'

/** HMAC ficticio y datos sinteticos; motor SQL y almacenamiento local reales. */
const SECRET = 'hmac-exclusivo-de-pruebas-db-de-account'
const SUBJECT = 'sub-db:jugador/activo'
const IDENTITY_PATH = '/api/internal/accounts/tournament-team-identity/validation'
const sign = (method: string, route: string, body: unknown = {}) => {
  const timestamp = String(Date.now())
  return {
    'x-internal-service': 'tournament',
    'x-internal-timestamp': timestamp,
    'x-internal-signature': signInternalRequest(SECRET, {
      service: 'tournament',
      method,
      path: route,
      timestamp,
      body,
    }),
  }
}

describe('Consultas Tournament con PostgreSQL y avatar en disco', () => {
  let container: TestPostgres
  let db: Kysely<Database>
  let app: INestApplication
  let accounts: AccountRepositoryPort
  let avatars: LocalAvatarStorage
  let previousEnv: NodeJS.ProcessEnv

  beforeAll(async () => {
    previousEnv = { ...process.env }
    container = await startTestPostgres()
    db = createDatabase({ connectionString: container.getConnectionUri(), maxConnections: 2 })
    const migration = await migrateToLatest(db)
    expect(migration.error).toBeUndefined()
    expect(migration.applied).toContain('z20261003-hu90-sanction-reason-code')
    Object.assign(process.env, {
      NODE_ENV: 'test',
      PERSISTENCE_DRIVER: 'postgres',
      DATABASE_URL: container.getConnectionUri(),
      AUTH_MODE: 'jwt',
      AUTHENTICATION_DRIVER: 'fake',
      COGNITO_USER_POOL_ID: 'us-east-1_pruebas',
      COGNITO_CLIENT_ID: 'cliente-de-pruebas',
      INTERNAL_SERVICE_AUTH_SECRET: SECRET,
      INTERNAL_SERVICE_ALLOWED_SERVICES: 'catalog,auction,combat',
      ACCOUNT_DELETION_PROCESSING_ENABLED: 'false',
    })
    avatars = new LocalAvatarStorage(
      path.resolve('.tmp', 'tournament-account', `avatars-db-${randomUUID()}`),
    )
    const ref = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DATABASE)
      .useValue(db)
      .overrideProvider(AVATAR_STORAGE)
      .useValue(avatars)
      .overrideProvider(TOKEN_VERIFIER)
      .useValue({ verify: () => Promise.reject(new TokenVerificationError()) })
      .compile()
    app = ref.createNestApplication()
    app.setGlobalPrefix('api')
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )
    await app.init()
    accounts = app.get<AccountRepositoryPort>(ACCOUNT_REPOSITORY)
    await accounts.save(
      buildActiveAccount({
        id: 'db-activo',
        subject: SUBJECT,
        email: 'activo-db@nexus.test',
        displayName: 'Jugador DB Activo',
      }),
    )
    await accounts.save(
      buildAccount({
        id: 'db-pendiente',
        subject: 'db-pendiente',
        email: 'pendiente-db@nexus.test',
        displayName: 'Jugador DB Pendiente',
      }),
    )
    await accounts.save(
      buildActiveAccount({
        id: 'db-admin',
        subject: 'db-admin',
        email: 'admin-db@nexus.test',
        displayName: 'Admin DB',
        roles: [Role.Administrator],
      }),
    )
    await avatars.store({
      accountId: 'db-activo',
      mimeType: 'image/png',
      originalName: 'a.png',
      bytes: Buffer.from('avatar-prueba'),
    })
  })
  afterAll(async () => {
    await app.close()
    await db.destroy()
    await container.stop()
    process.env = previousEnv
  })
  const get = (subject: string) => {
    const route = `/api/internal/accounts/${encodeURIComponent(subject)}/tournament-eligibility`
    return request(app.getHttpServer()).get(route).set(sign('GET', route))
  }
  const validate = (name: string, avatarSubject = SUBJECT) => {
    const body = { name, avatarSubject }
    return request(app.getHttpServer())
      .post(IDENTITY_PATH)
      .set(sign('POST', IDENTITY_PATH, body))
      .send(body)
  }

  it('lee sujeto y roles persistidos y no confunde sub con ID interno', async () => {
    const response = await get(SUBJECT)
    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      subject: SUBJECT,
      displayName: 'Jugador DB Activo',
      eligible: true,
    })
    expect((await get('db-activo')).status).toBe(404)
    expect((await get('db-pendiente')).body.eligible).toBe(false)
    expect((await get('db-admin')).body.eligible).toBe(false)
  })
  it('la validacion recupera bytes reales de disco sin reservar el apodo de la cuenta', async () => {
    const before = await db
      .selectFrom('accounts')
      .selectAll()
      .where('id', '=', 'db-activo')
      .executeTakeFirstOrThrow()
    const response = await validate('  Jugador   DB Activo  ')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      name: 'Jugador DB Activo',
      avatar: { kind: 'ACCOUNT_AVATAR', subject: SUBJECT },
      policyVersion: 'account-team-identity-v1',
    })
    const after = await db
      .selectFrom('accounts')
      .selectAll()
      .where('id', '=', 'db-activo')
      .executeTakeFirstOrThrow()
    expect(after).toEqual(before)
  })
  it('consulta la blacklist persistente actualizada, sin cache de elegibilidad', async () => {
    await db
      .insertInto('nickname_blacklist_entries')
      .values({ id: 'tournament-policy-test', term: 'Prohibido DB', active: true })
      .execute()
    const rejected = await validate('Equipo Prohibido DB')
    expect(rejected.status).toBe(422)
    expect(rejected.body.code).toBe('INVALID_TEAM_NAME')
    await db
      .updateTable('nickname_blacklist_entries')
      .set({ active: false })
      .where('id', '=', 'tournament-policy-test')
      .execute()
    expect((await validate('Equipo Prohibido DB')).status).toBe(200)
  })
  it('una suspension persistida cambia la respuesta sin reactivar ni escribir', async () => {
    const account = await accounts.findBySubject(SUBJECT)
    if (account === null) throw new Error('Falta el fixture persistido.')
    account.suspend()
    await accounts.save(account)
    const before = await db
      .selectFrom('accounts')
      .selectAll()
      .where('id', '=', 'db-activo')
      .executeTakeFirstOrThrow()
    expect((await get(SUBJECT)).body.eligible).toBe(false)
    const after = await db
      .selectFrom('accounts')
      .selectAll()
      .where('id', '=', 'db-activo')
      .executeTakeFirstOrThrow()
    expect(after).toEqual(before)
  })
  it('avatar eliminado y cuenta inexistente conservan errores distintos', async () => {
    await avatars.remove('db-activo/a.png')
    const absent = await validate('Equipo Sin Imagen')
    expect(absent.status).toBe(422)
    expect(absent.body.code).toBe('INVALID_TEAM_AVATAR')
    expect((await validate('Equipo Sin Cuenta', 'cuenta-inexistente')).status).toBe(404)
  })
})
