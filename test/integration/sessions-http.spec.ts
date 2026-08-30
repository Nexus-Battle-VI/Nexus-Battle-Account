import 'reflect-metadata'

import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../../src/infrastructure/bootstrap/app.module'
import { Role } from '../../src/domain/entities/Role'
import { EmailAddress } from '../../src/domain/value-objects/EmailAddress'
import { ACCOUNT_REPOSITORY } from '../../src/application/ports/AccountRepositoryPort'
import { AUTHENTICATION_PROVIDER } from '../../src/application/ports/AuthenticationProviderPort'
import type { FakeAuthenticationProvider } from '../../src/adapters/outbound/identity/FakeAuthenticationProvider'
import {
  TOKEN_VERIFIER,
  TokenVerificationError,
  type TokenVerifierPort,
  type VerifiedIdentity,
} from '../../src/application/ports/TokenVerifierPort'
import { ROLE_DIRECTORY } from '../../src/application/ports/RoleDirectoryPort'
import { InMemoryRoleDirectory } from '../../src/adapters/outbound/identity/InMemoryRoleDirectory'
import { InMemoryIdentitySignUp } from '../../src/adapters/outbound/identity/InMemoryIdentitySignUp'
import { IDENTITY_SIGN_UP } from '../../src/application/ports/IdentitySignUpPort'
import { registerAccountRequest } from '../support/http-register'
import { VALID_PASSWORD, buildActiveAccount } from '../support/account-factory'

/**
 * Integracion HTTP de HU-02 (Nexus-Battle-Management#11 / task #90).
 *
 * Sigue el mismo patron que `auth-http.spec.ts`: se activa `AUTH_MODE=jwt` de
 * verdad -para que `SessionsController` conviva con los guards reales- y solo
 * se sustituye lo que exigiria una red o un pool de Cognito real:
 * `TOKEN_VERIFIER` (verificacion de testimonios ya emitidos) y
 * `AUTHENTICATION_PROVIDER` (verificacion de contrasena y segundo factor).
 *
 * `dynamicIdentities` es el puente entre ambos dobles: `FakeAuthenticationProvider`
 * emite testimonios reales (no predecibles de antemano), y este mapa deja que
 * el mismo testimonio que devuelve un login se reconozca despues en una ruta
 * protegida -eso es exactamente lo que CA-05 pide demostrar.
 */

const FIXED_IDENTITIES: Readonly<Record<string, VerifiedIdentity>> = {
  'token-registro': {
    subject: 'sujeto-registro',
    roles: new Set([Role.Player]),
  },
  'token-administrador-verificador': {
    subject: 'sujeto-admin-verificador',
    roles: new Set([Role.Player, Role.Administrator]),
  },
}

const dynamicIdentities = new Map<string, VerifiedIdentity>()

const stubVerifier: TokenVerifierPort = {
  verify: (token: string): Promise<VerifiedIdentity> => {
    const identity = FIXED_IDENTITIES[token] ?? dynamicIdentities.get(token)

    return identity === undefined
      ? Promise.reject(new TokenVerificationError())
      : Promise.resolve(identity)
  },
}

describe('API de sesiones (HU-02)', () => {
  let app: INestApplication
  let previousEnv: Record<string, string | undefined>
  let authProvider: FakeAuthenticationProvider

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
      // Con `AUTH_MODE=jwt` la raiz de composicion elige el directorio real, que
      // hablaria con un pool que aqui no existe. Que estas pruebas fallaran sin
      // esta sustitucion es la prueba de que el registro **falla cerrado**
      // cuando el rol no se puede reflejar: es el comportamiento buscado.
      .overrideProvider(ROLE_DIRECTORY)
      .useValue(new InMemoryRoleDirectory())
      .overrideProvider(IDENTITY_SIGN_UP)
      .useValue(new InMemoryIdentitySignUp())
      .compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('api')
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )

    await app.init()

    authProvider = moduleRef.get(AUTHENTICATION_PROVIDER)
  })

  afterAll(async () => {
    await app.close()

    for (const [key, value] of Object.entries(previousEnv)) {
      process.env[key] = value ?? ''
    }
  })

  /**
   * Registra, activa y siembra las credenciales de un jugador de pruebas.
   *
   * Cada jugador registra con un testimonio -y por tanto un `sub`- propio y
   * distinto (`dynamicIdentities`, no una identidad fija compartida): dos
   * cuentas con el mismo sujeto harian ambigua `findBySubject`, exactamente
   * la invariante que `AccountRepositoryPort` documenta.
   */
  const givenActivePlayer = async (
    email: string,
    nickname: string,
    password = VALID_PASSWORD,
  ): Promise<{ id: string; subject: string }> => {
    // El alta es publica: sin token. El sujeto lo deriva el doble del correo,
    // el mismo que despues resuelve el login.
    const subject = `sub:${email.trim().toLowerCase()}`

    const created = await registerAccountRequest(app, { email, nickname, password })

    // Se confirma el correo con el codigo fijo del doble, que la activa.
    await request(app.getHttpServer())
      .post('/api/accounts/confirmation')
      .send({ identifier: email, code: '000000' })

    authProvider.seed({ email, password })

    return { id: (created.body as { id: string }).id, subject }
  }

  /** Inserta una cuenta administrativa directamente en el repositorio (sin API publica). */
  const givenAdministrativeAccount = async (
    email: string,
    nickname: string,
    role: typeof Role.Administrator | typeof Role.SuperAdministrator,
    password = VALID_PASSWORD,
  ): Promise<void> => {
    const accounts = app.get(ACCOUNT_REPOSITORY)
    await accounts.save(
      buildActiveAccount({
        id: `acc-${email}`,
        subject: `sujeto-${email}`,
        email,
        displayName: nickname,
        roles: [Role.Player, role],
      }),
    )
    authProvider.seed({ email, password, requiresSecondFactor: true, secondFactorCode: '123456' })
  }

  it('CA-01: correo + contrasena correctos autentica y devuelve el rol vigente', async () => {
    await givenActivePlayer('ca01@nexus.test', 'JugadorUno')

    const response = await request(app.getHttpServer())
      .post('/api/sessions')
      .send({ identifier: 'ca01@nexus.test', password: VALID_PASSWORD })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      status: 'AUTHENTICATED',
      account: { email: 'ca01@nexus.test', roles: ['PLAYER'] },
    })
    expect(typeof response.body.accessToken).toBe('string')
  })

  /**
   * `account.id` (identificador de Account) y `account.subject` (sub real del
   * proveedor) deben viajar como dos campos DISTINTOS: `givenActivePlayer`
   * registra con el testimonio `token-registro-<email>`, cuyo sujeto fijo
   * (`sujeto-<email>`) es literalmente otro valor que el UUID que
   * `RegisterAccount` genera para `id`.
   */
  it('el subject real viaja explicito y nunca se confunde con account.id', async () => {
    await givenActivePlayer('subject-real@nexus.test', 'JugadorSujetoReal')

    const response = await request(app.getHttpServer())
      .post('/api/sessions')
      .send({ identifier: 'subject-real@nexus.test', password: VALID_PASSWORD })

    expect(response.status).toBe(200)
    expect(response.body.account.subject).toBe('sub:subject-real@nexus.test')
    expect(response.body.account.id).not.toBe(response.body.account.subject)
    expect(typeof response.body.account.id).toBe('string')
  })

  it('CA-02: apodo + contrasena correctos autentica sin que el cliente conozca el correo', async () => {
    await givenActivePlayer('ca02@nexus.test', 'ApodoJugadorDos')

    const response = await request(app.getHttpServer())
      .post('/api/sessions')
      .send({ identifier: 'ApodoJugadorDos', password: VALID_PASSWORD })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ status: 'AUTHENTICATED' })
  })

  it('CA-03: contrasena incorrecta responde 401 sin crear sesion', async () => {
    await givenActivePlayer('ca03@nexus.test', 'JugadorTres')

    const response = await request(app.getHttpServer())
      .post('/api/sessions')
      .send({ identifier: 'ca03@nexus.test', password: 'Incorrecta1!' })

    expect(response.status).toBe(401)
    expect(response.body).not.toHaveProperty('accessToken')
  })

  it('un identificador que no existe responde exactamente igual que una contrasena incorrecta', async () => {
    const inexistente = await request(app.getHttpServer())
      .post('/api/sessions')
      .send({ identifier: 'nadie@nexus.test', password: 'lo-que-sea' })

    expect(inexistente.status).toBe(401)
    expect(inexistente.body.message).toBe('Las credenciales no son validas.')
  })

  it('el contrato de login rechaza un campo "role" no declarado (CA-09 / EN-002)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/sessions')
      .send({ identifier: 'ca01@nexus.test', password: VALID_PASSWORD, role: 'ADMINISTRATOR' })

    expect(response.status).toBe(400)
  })

  it('CA-04: resuelve el rol vigente de la cuenta, no uno enviado por el cliente', async () => {
    await givenActivePlayer('ca04-moderador@nexus.test', 'RolElevadoCuatro')

    const accounts = app.get(ACCOUNT_REPOSITORY)
    const stored = await accounts.findByEmail(EmailAddress.create('ca04-moderador@nexus.test'))

    if (stored === null) {
      throw new Error('la cuenta de la prueba deberia existir')
    }

    stored.grantRole(Role.Moderator, new Set([Role.Administrator]))
    await accounts.save(stored)

    const response = await request(app.getHttpServer())
      .post('/api/sessions')
      .send({ identifier: 'ca04-moderador@nexus.test', password: VALID_PASSWORD })

    expect(response.body).toMatchObject({
      status: 'AUTHENTICATED',
      account: { roles: expect.arrayContaining(['PLAYER', 'MODERATOR']) as string[] },
    })
  })

  it('CA-05: el testimonio devuelto por el login autoriza una ruta protegida', async () => {
    const { subject } = await givenActivePlayer('ca05@nexus.test', 'JugadorCinco')

    const login = await request(app.getHttpServer())
      .post('/api/sessions')
      .send({ identifier: 'ca05@nexus.test', password: VALID_PASSWORD })

    const accessToken = login.body.accessToken as string
    dynamicIdentities.set(accessToken, {
      subject,
      roles: new Set([Role.Player]),
    })

    const own = await request(app.getHttpServer())
      .get('/api/accounts/me')
      .set('Authorization', `Bearer ${accessToken}`)

    expect(own.status).toBe(200)
    expect(own.body).toMatchObject({ email: 'ca05@nexus.test' })
  })

  it.each([
    ['Administrador', Role.Administrator],
    ['Super Administrador', Role.SuperAdministrator],
  ])(
    'CA-06: %s con credenciales validas recibe segundo factor requerido, no una sesion',
    async (_nombre, role) => {
      const email = `ca06-${role}@nexus.test`
      await givenAdministrativeAccount(email, `Admin${role}`, role)

      const response = await request(app.getHttpServer())
        .post('/api/sessions')
        .send({ identifier: email, password: VALID_PASSWORD })

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ status: 'SECOND_FACTOR_REQUIRED' })
      expect(response.body).not.toHaveProperty('accessToken')
      expect(typeof response.body.challengeToken).toBe('string')
    },
  )

  it('CA-07: segundo factor valido completa la sesion administrativa', async () => {
    const email = 'ca07@nexus.test'
    await givenAdministrativeAccount(email, 'AdminSiete', Role.Administrator)

    const login = await request(app.getHttpServer())
      .post('/api/sessions')
      .send({ identifier: email, password: VALID_PASSWORD })

    const response = await request(app.getHttpServer()).post('/api/sessions/second-factor').send({
      identifier: email,
      challengeToken: login.body.challengeToken,
      code: '123456',
    })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      status: 'AUTHENTICATED',
      account: { roles: expect.arrayContaining(['ADMINISTRATOR']) as string[] },
    })
  })

  it('CA-08: segundo factor invalido no completa la sesion administrativa', async () => {
    const email = 'ca08-invalido@nexus.test'
    await givenAdministrativeAccount(email, 'AdminOchoInvalido', Role.Administrator)

    const login = await request(app.getHttpServer())
      .post('/api/sessions')
      .send({ identifier: email, password: VALID_PASSWORD })

    const response = await request(app.getHttpServer()).post('/api/sessions/second-factor').send({
      identifier: email,
      challengeToken: login.body.challengeToken,
      code: '000000',
    })

    expect(response.status).toBe(401)
    expect(response.body).not.toHaveProperty('accessToken')
  })

  it('CA-08: segundo factor no completado no habilita operaciones administrativas', async () => {
    const email = 'ca08-no-completado@nexus.test'
    await givenAdministrativeAccount(email, 'AdminOchoPendiente', Role.Administrator)

    await request(app.getHttpServer())
      .post('/api/sessions')
      .send({ identifier: email, password: VALID_PASSWORD })

    // Nunca se llama a /second-factor. La cuenta no tiene forma de obtener
    // una sesion administrativa sin completarlo.
    const response = await request(app.getHttpServer()).post('/api/sessions/second-factor').send({
      identifier: email,
      challengeToken: 'un-token-que-nunca-se-uso',
      code: '123456',
    })

    expect(response.status).toBe(401)
  })
})
