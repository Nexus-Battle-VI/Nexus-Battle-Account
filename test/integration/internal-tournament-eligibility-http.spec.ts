import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../../src/infrastructure/bootstrap/app.module'
import { signInternalRequest } from '../../src/adapters/inbound/http/auth/internal-signature'
import {
  ACCOUNT_REPOSITORY,
  type AccountRepositoryPort,
} from '../../src/application/ports/AccountRepositoryPort'
import { AVATAR_STORAGE } from '../../src/application/ports/AvatarStoragePort'
import { NICKNAME_BLACKLIST } from '../../src/application/ports/NicknameBlacklistPort'
import {
  TOKEN_VERIFIER,
  TokenVerificationError,
  type VerifiedIdentity,
} from '../../src/application/ports/TokenVerifierPort'
import { InMemoryAvatarStorage } from '../../src/adapters/outbound/storage/InMemoryAvatarStorage'
import { InMemoryNicknameBlacklist } from '../../src/adapters/outbound/persistence/InMemoryNicknameBlacklist'
import { Role } from '../../src/domain/entities/Role'
import { buildAccount, buildActiveAccount } from '../support/account-factory'

/** Exclusivo de pruebas; no acredita secretos ni sesiones Cognito reales. */
const SECRET = 'hmac-local-exclusivo-de-la-suite-de-torneos'
const SUBJECT = 'identidad:jugador/uno+prueba'
const pathFor = (subject = SUBJECT): string =>
  `/api/internal/accounts/${encodeURIComponent(subject)}/tournament-eligibility`
const IDENTITY_PATH = '/api/internal/accounts/tournament-team-identity/validation'
const BODY = { name: 'Equipo Nuevo', avatarSubject: SUBJECT }
const sign = (
  path: string,
  body: unknown = {},
  options: { method?: string; service?: string; timestamp?: string; signature?: string } = {},
): Record<string, string> => {
  const service = options.service ?? 'tournament'
  const timestamp = options.timestamp ?? String(Date.now())
  return {
    'x-internal-service': service,
    'x-internal-timestamp': timestamp,
    'x-internal-signature':
      options.signature ??
      signInternalRequest(SECRET, {
        service,
        method: options.method ?? 'GET',
        path,
        timestamp,
        body,
      }),
  }
}

describe('Contrato Account/Tournament v2, composicion JWT activa', () => {
  let app: INestApplication
  let unconfiguredApp: INestApplication
  let previousEnv: NodeJS.ProcessEnv
  let accounts: AccountRepositoryPort
  const avatars = new InMemoryAvatarStorage()
  const blacklist = new InMemoryNicknameBlacklist([
    { term: 'vedado', active: true },
    { term: 'antiguo', active: false },
  ])
  const verifier = {
    verify: jest.fn((token: string): Promise<VerifiedIdentity> =>
      token === 'sesion-controlada-de-prueba'
        ? Promise.resolve({
            subject: SUBJECT,
            roles: new Set([Role.Player]),
            jti: null,
            expiresAt: null,
          })
        : Promise.reject(new TokenVerificationError()),
    ),
  }
  const createApp = async (secret: string): Promise<INestApplication> => {
    process.env.INTERNAL_SERVICE_AUTH_SECRET = secret
    const ref = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AVATAR_STORAGE)
      .useValue(avatars)
      .overrideProvider(NICKNAME_BLACKLIST)
      .useValue(blacklist)
      .overrideProvider(TOKEN_VERIFIER)
      .useValue(verifier)
      .compile()
    const instance = ref.createNestApplication()
    instance.setGlobalPrefix('api')
    instance.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )
    await instance.init()
    return instance
  }
  beforeAll(async () => {
    previousEnv = { ...process.env }
    Object.assign(process.env, {
      NODE_ENV: 'test',
      PERSISTENCE_DRIVER: 'memory',
      AUTH_MODE: 'jwt',
      AUTHENTICATION_DRIVER: 'fake',
      COGNITO_USER_POOL_ID: 'us-east-1_pruebas',
      COGNITO_CLIENT_ID: 'cliente-de-pruebas',
      ACCOUNT_DELETION_PROCESSING_ENABLED: 'false',
      // Se incluye deliberadamente para comprobar que no abre otras rutas.
      INTERNAL_SERVICE_ALLOWED_SERVICES: 'catalog,auction,combat,tournament',
    })
    app = await createApp(SECRET)
    unconfiguredApp = await createApp('')
    accounts = app.get<AccountRepositoryPort>(ACCOUNT_REPOSITORY)
    const suspended = buildActiveAccount({ id: 'suspendido', subject: 'suspendido' })
    suspended.suspend()
    const banned = buildActiveAccount({ id: 'baneado', subject: 'baneado' })
    banned.ban()
    for (const account of [
      buildActiveAccount({ id: 'activo', subject: SUBJECT }),
      buildAccount({ id: 'pendiente', subject: 'pendiente' }),
      suspended,
      banned,
      buildActiveAccount({ id: 'admin', subject: 'admin', roles: [Role.Administrator] }),
      buildActiveAccount({
        id: 'jugador-admin',
        subject: 'jugador-admin',
        roles: [Role.Player, Role.Administrator],
      }),
      buildActiveAccount({ id: 'sin-avatar', subject: 'sin-avatar' }),
      buildActiveAccount({ id: 'avatar-vacio', subject: 'avatar-vacio' }),
    ])
      await accounts.save(account)
    await avatars.store({
      accountId: 'activo',
      mimeType: 'image/png',
      originalName: 'a.png',
      bytes: Buffer.from('imagen-de-prueba'),
    })
    await avatars.store({
      accountId: 'avatar-vacio',
      mimeType: 'image/png',
      originalName: 'a.png',
      bytes: Buffer.alloc(0),
    })
  })
  afterEach(() => {
    jest.restoreAllMocks()
    verifier.verify.mockClear()
  })
  afterAll(async () => {
    await app.close()
    await unconfiguredApp.close()
    process.env = previousEnv
  })
  const get = (subject = SUBJECT) =>
    request(app.getHttpServer())
      .get(pathFor(subject))
      .set(sign(pathFor(subject)))
  const validate = (body: Record<string, unknown> = BODY) =>
    request(app.getHttpServer())
      .post(IDENTITY_PATH)
      .set(sign(IDENTITY_PATH, body, { method: 'POST' }))
      .send(body)

  it('devuelve el sujeto consultado, apodo y elegibilidad exclusivamente, sin JWT', async () => {
    const response = await get()
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ subject: SUBJECT, displayName: 'Ana Ramirez', eligible: true })
    expect(verifier.verify).not.toHaveBeenCalled()
  })
  it.each([
    ['pendiente', false],
    ['suspendido', false],
    ['baneado', false],
    ['admin', false],
    ['jugador-admin', true],
  ])('deriva elegibilidad del estado y roles persistidos de %s', async (subject, eligible) => {
    const response = await get(subject)
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ subject, displayName: 'Ana Ramirez', eligible })
  })
  it('no acepta actividad o roles del navegador ni reactiva una cuenta por lectura', async () => {
    const save = jest.spyOn(accounts, 'save')
    const response = await request(app.getHttpServer())
      .get(`${pathFor('suspendido')}?eligible=true&status=ACTIVE&role=PLAYER`)
      .set(sign(pathFor('suspendido')))
    expect(response.body.eligible).toBe(false)
    expect(save).not.toHaveBeenCalled()
    expect((await accounts.findBySubject('suspendido'))?.currentStatus).toBe('SUSPENDED')
  })
  it('cuenta inexistente devuelve 404 sin perfil adicional', async () => {
    const response = await get('inexistente')
    expect(response.status).toBe(404)
    expect(response.body.message).toBe('La cuenta no existe.')
  })
  it('falla cerrado si el repositorio devuelve otro sujeto', async () => {
    jest
      .spyOn(accounts, 'findBySubject')
      .mockResolvedValueOnce(buildActiveAccount({ subject: 'otra-identidad' }))
    const response = await get()
    expect(response.status).toBe(503)
    expect(JSON.stringify(response.body)).not.toContain('otra-identidad')
  })
  it('repositorio caido devuelve 503, no cuenta inelegible ni detalle interno', async () => {
    jest.spyOn(accounts, 'findBySubject').mockRejectedValueOnce(new Error('detalle-privado-db'))
    const response = await get()
    expect(response.status).toBe(503)
    expect(JSON.stringify(response.body)).not.toContain('detalle-privado-db')
  })
  it('normaliza nombre Unicode y devuelve referencia de avatar sin bytes ni claves', async () => {
    const response = await validate({ ...BODY, name: '  Águila   7  ' })
    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      name: 'Águila 7',
      avatar: { kind: 'ACCOUNT_AVATAR', subject: SUBJECT },
      policyVersion: 'account-team-identity-v1',
    })
  })
  it('no exige unicidad de apodo ni escribe al repetir la validacion', async () => {
    const save = jest.spyOn(accounts, 'save')
    const store = jest.spyOn(avatars, 'store')
    const exists = jest.spyOn(accounts, 'existsByDisplayName')
    const first = await validate({ ...BODY, name: 'Ana Ramirez' })
    const second = await validate({ ...BODY, name: 'Ana Ramirez' })
    expect(first.status).toBe(200)
    expect(second.body).toEqual(first.body)
    expect(save).not.toHaveBeenCalled()
    expect(store).not.toHaveBeenCalled()
    expect(exists).not.toHaveBeenCalled()
  })
  it.each(['ab', 'x'.repeat(33), '.Equipo', 'Equipo.', 'Equipo!'])(
    'rechaza nombre fuera de la politica: %s',
    async (name) => {
      const response = await validate({ ...BODY, name })
      expect(response.status).toBe(422)
      expect(response.body.code).toBe('INVALID_TEAM_NAME')
    },
  )
  it.each(['Sol', 'x'.repeat(32)])('acepta la frontera de longitud: %s', async (name) => {
    expect((await validate({ ...BODY, name })).status).toBe(200)
  })
  it('aplica blacklist activa y permite terminos desactivados', async () => {
    const response = await validate({ ...BODY, name: 'Equipo VEDADO' })
    expect(response.status).toBe(422)
    expect(response.body.code).toBe('INVALID_TEAM_NAME')
    expect((await validate({ ...BODY, name: 'Equipo Antiguo' })).status).toBe(200)
  })
  it('reconsulta la blacklist vigente', async () => {
    const body = { ...BODY, name: 'Equipo Dinamico' }
    expect((await validate(body)).status).toBe(200)
    blacklist.add('dinamico', true)
    expect((await validate(body)).body.code).toBe('INVALID_TEAM_NAME')
  })
  it.each(['sin-avatar', 'avatar-vacio'])(
    'rechaza avatar no recuperable: %s',
    async (avatarSubject) => {
      const response = await validate({ ...BODY, avatarSubject })
      expect(response.status).toBe(422)
      expect(response.body.code).toBe('INVALID_TEAM_AVATAR')
    },
  )
  it('cuenta de avatar inexistente devuelve 404', async () => {
    expect((await validate({ ...BODY, avatarSubject: 'inexistente' })).status).toBe(404)
  })
  it('almacenamiento caido devuelve 503 sin claves o rutas', async () => {
    jest.spyOn(avatars, 'read').mockRejectedValueOnce(new Error('clave-y-ruta-privadas'))
    const response = await validate()
    expect(response.status).toBe(503)
    expect(JSON.stringify(response.body)).not.toContain('clave-y-ruta-privadas')
  })
  it('blacklist no disponible devuelve 503 sin su detalle', async () => {
    jest.spyOn(blacklist, 'isBlocked').mockRejectedValueOnce(new Error('detalle-privado-politica'))
    const response = await validate()
    expect(response.status).toBe(503)
    expect(JSON.stringify(response.body)).not.toContain('detalle-privado-politica')
  })
  it.each([
    { name: 'Equipo' },
    { ...BODY, name: 7 },
    { ...BODY, avatarSubject: null },
    { ...BODY, roles: ['PLAYER'], eligible: true },
    { ...BODY, avatarUrl: 'imagen-ajena' },
  ])('rechaza formato o autoridad extra: %j', async (body) => {
    expect((await validate(body)).status).toBe(400)
  })
  it.each(['catalog', 'auction', 'combat', 'intruso'])(
    'rechaza caller %s con HMAC valido en ambas rutas',
    async (service) => {
      const getResponse = await request(app.getHttpServer())
        .get(pathFor())
        .set(sign(pathFor(), {}, { service }))
      const postResponse = await request(app.getHttpServer())
        .post(IDENTITY_PATH)
        .set(sign(IDENTITY_PATH, BODY, { method: 'POST', service }))
        .send(BODY)
      expect(getResponse.status).toBe(401)
      expect(postResponse.status).toBe(401)
      expect(getResponse.body.message).toBe(postResponse.body.message)
    },
  )
  it('JWT controlado sin HMAC no concede acceso interno', async () => {
    expect(
      (
        await request(app.getHttpServer())
          .get(pathFor())
          .set('Authorization', 'Bearer sesion-controlada-de-prueba')
      ).status,
    ).toBe(401)
    expect(
      (
        await request(app.getHttpServer())
          .post(IDENTITY_PATH)
          .set('Authorization', 'Bearer sesion-controlada-de-prueba')
          .send(BODY)
      ).status,
    ).toBe(401)
  })
  it.each([{ signature: 'a'.repeat(64) }, { timestamp: String(Date.now() - 600_000) }])(
    'rechaza firma invalida/caducada: %j',
    async (options) => {
      expect(
        (
          await request(app.getHttpServer())
            .get(pathFor())
            .set(sign(pathFor(), {}, options))
        ).status,
      ).toBe(401)
      expect(
        (
          await request(app.getHttpServer())
            .post(IDENTITY_PATH)
            .set(sign(IDENTITY_PATH, BODY, { ...options, method: 'POST' }))
            .send(BODY)
        ).status,
      ).toBe(401)
    },
  )
  it('HMAC cubre sujeto, metodo y cuerpo', async () => {
    expect(
      (await request(app.getHttpServer()).get(pathFor('pendiente')).set(sign(pathFor()))).status,
    ).toBe(401)
    expect(
      (
        await request(app.getHttpServer())
          .post(IDENTITY_PATH)
          .set(sign(IDENTITY_PATH, BODY, { method: 'POST' }))
          .send({ ...BODY, name: 'Otro Equipo' })
      ).status,
    ).toBe(401)
    expect(
      (
        await request(app.getHttpServer())
          .post(IDENTITY_PATH)
          .set(sign(IDENTITY_PATH, BODY))
          .send(BODY)
      ).status,
    ).toBe(401)
  })
  it('tournament no hereda battle-profile y Combat conserva acceso', async () => {
    const path = `/api/internal/accounts/${encodeURIComponent(SUBJECT)}/battle-profile`
    expect((await request(app.getHttpServer()).get(path).set(sign(path))).status).toBe(401)
    expect(
      (
        await request(app.getHttpServer())
          .get(path)
          .set(sign(path, {}, { service: 'combat' }))
      ).status,
    ).toBe(200)
  })
  it('tournament tampoco obtiene acceso a sanciones o evidencia MFA', async () => {
    const sanctionsPath = `/api/internal/accounts/${encodeURIComponent(SUBJECT)}/active-sanctions`
    expect(
      (await request(app.getHttpServer()).get(sanctionsPath).set(sign(sanctionsPath))).status,
    ).toBe(401)
    const mfaPath = '/api/internal/mfa-evidence/verification'
    const body = { subject: SUBJECT, evidenceId: 'evidencia-de-prueba' }
    expect(
      (
        await request(app.getHttpServer())
          .post(mfaPath)
          .set(sign(mfaPath, body, { method: 'POST' }))
          .send(body)
      ).status,
    ).toBe(401)
  })
  it('la autorizacion explicita no necesita habilitar tournament globalmente', async () => {
    process.env.INTERNAL_SERVICE_ALLOWED_SERVICES = 'catalog,auction,combat'
    const explicitApp = await createApp(SECRET)
    try {
      const path = pathFor('cuenta-inexistente')
      expect((await request(explicitApp.getHttpServer()).get(path).set(sign(path))).status).toBe(
        404,
      )
    } finally {
      await explicitApp.close()
    }
  })
  it('la guarda HMAC tambien protege estas rutas con JWT deshabilitado en desarrollo', async () => {
    process.env.AUTH_MODE = 'disabled'
    const devApp = await createApp(SECRET)
    try {
      expect((await request(devApp.getHttpServer()).get(pathFor())).status).toBe(401)
      expect((await request(devApp.getHttpServer()).post(IDENTITY_PATH).send(BODY)).status).toBe(
        401,
      )
    } finally {
      await devApp.close()
    }
  })
  it('las rutas publicas protegidas exigen JWT, no HMAC de servicio', async () => {
    const path = '/api/accounts/me'
    expect((await request(app.getHttpServer()).get(path).set(sign(path))).status).toBe(401)
    expect(
      (
        await request(app.getHttpServer())
          .get(path)
          .set('Authorization', 'Bearer sesion-controlada-de-prueba')
      ).status,
    ).toBe(200)
  })
  it('sin secreto configurado ambas rutas fallan con 503', async () => {
    expect(
      (await request(unconfiguredApp.getHttpServer()).get(pathFor()).set(sign(pathFor()))).status,
    ).toBe(503)
    const response = await request(unconfiguredApp.getHttpServer())
      .post(IDENTITY_PATH)
      .set(sign(IDENTITY_PATH, BODY, { method: 'POST' }))
      .send(BODY)
    expect(response.status).toBe(503)
    expect(JSON.stringify(response.body)).not.toContain(SECRET)
  })
})
