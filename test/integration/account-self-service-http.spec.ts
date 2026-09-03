import 'reflect-metadata'

import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../../src/infrastructure/bootstrap/app.module'
import { Role } from '../../src/domain/entities/Role'
import {
  TOKEN_VERIFIER,
  TokenVerificationError,
  type TokenVerifierPort,
  type VerifiedIdentity,
} from '../../src/application/ports/TokenVerifierPort'
import { IDENTITY_SIGN_UP } from '../../src/application/ports/IdentitySignUpPort'
import { ROLE_DIRECTORY } from '../../src/application/ports/RoleDirectoryPort'
import { MFA_STATUS } from '../../src/application/ports/MfaStatusPort'
import { SESSION_REVOCATION } from '../../src/application/ports/SessionRevocationPort'
import { PASSWORD_CHANGE } from '../../src/application/ports/PasswordChangePort'
import { ACCOUNT_REPOSITORY } from '../../src/application/ports/AccountRepositoryPort'
import type { AccountRepositoryPort } from '../../src/application/ports/AccountRepositoryPort'
import { InMemoryIdentitySignUp } from '../../src/adapters/outbound/identity/InMemoryIdentitySignUp'
import { InMemoryRoleDirectory } from '../../src/adapters/outbound/identity/InMemoryRoleDirectory'
import { InMemoryMfaStatus } from '../../src/adapters/outbound/identity/InMemoryMfaStatus'
import { InMemorySessionRevocation } from '../../src/adapters/outbound/identity/InMemorySessionRevocation'
import { InMemoryPasswordChange } from '../../src/adapters/outbound/identity/InMemoryPasswordChange'
import { registerAccountRequest } from '../support/http-register'
import { buildActiveAccount } from '../support/account-factory'

/**
 * Integracion self-service de HU-05 (`PATCH /api/accounts/me` y
 * `POST /api/accounts/me/password`) con la autenticacion ACTIVA.
 *
 * Se levanta la aplicacion real con `AUTH_MODE=jwt`, de modo que los guards se
 * registran de verdad. Solo se sustituye lo que hablaria con un pool de Cognito
 * real: el verificador de testimonios, el alta de identidad, el reflejo del rol
 * y el cambio de contrasena.
 */
const CURRENT_PASSWORD = 'Contrasena-Actual-Ficticia-1'
const CURRENT_PASSWORD_B = 'Contrasena-Actual-Ficticia-B-1'

const IDENTITIES: Readonly<Record<string, VerifiedIdentity>> = {
  // El sujeto es el que deriva el alta (`sub:<correo>`), para que /me encuentre
  // la cuenta de 'ana@nexus.test' creada en beforeAll.
  'token-jugador': {
    subject: 'sub:ana@nexus.test',
    roles: new Set([Role.Player]),
    jti: null,
    expiresAt: null,
  },
  // Usuario B para las pruebas de aislamiento entre titulares (CA-08): su cuenta
  // tambien se crea en beforeAll y su credencial se siembra por separado.
  'token-jugador-b': {
    subject: 'sub:beatriz@nexus.test',
    roles: new Set([Role.Player]),
    jti: null,
    expiresAt: null,
  },
  // Titular de una cuenta suspendida, para la evidencia de CA-01 en GET /me.
  'token-suspendida': {
    subject: 'sub:carla@nexus.test',
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

const bearer = (token: string): string => `Bearer ${token}`

describe('API self-service de la cuenta propia (HU-05)', () => {
  let app: INestApplication
  let previousEnv: Record<string, string | undefined>
  const passwords = new InMemoryPasswordChange()

  beforeAll(async () => {
    previousEnv = {
      AUTH_MODE: process.env.AUTH_MODE,
      COGNITO_USER_POOL_ID: process.env.COGNITO_USER_POOL_ID,
      COGNITO_CLIENT_ID: process.env.COGNITO_CLIENT_ID,
    }

    process.env.AUTH_MODE = 'jwt'
    process.env.COGNITO_USER_POOL_ID = 'us-east-1_pruebas'
    process.env.COGNITO_CLIENT_ID = 'cliente-de-pruebas'

    passwords.seed('token-jugador', CURRENT_PASSWORD)
    passwords.seed('token-jugador-b', CURRENT_PASSWORD_B)

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
      .overrideProvider(PASSWORD_CHANGE)
      .useValue(passwords)
      .compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('api')
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )

    await app.init()

    // Cuenta ajena, para el choque de apodo por OTRO propietario.
    await app.get<AccountRepositoryPort>(ACCOUNT_REPOSITORY).save(
      buildActiveAccount({
        id: 'acc-ajena',
        subject: 'sujeto-ajeno',
        email: 'ajena@nexus.test',
        displayName: 'Nombre Ocupado',
      }),
    )

    // El alta es PUBLICA: la identidad la crea el propio endpoint (`sub:ana@nexus.test`).
    await registerAccountRequest(app, { email: 'ana@nexus.test', nickname: 'Ana Ramirez' })

    // Usuario B (CA-08): segunda cuenta poblada y autenticable, creada por el
    // mismo alta publica (`sub:beatriz@nexus.test`).
    await registerAccountRequest(app, { email: 'beatriz@nexus.test', nickname: 'Beatriz Lopez' })

    // Cuenta SUSPENDIDA (CA-01): se restaura activa y se suspende a traves del
    // propio agregado, ya que no hay endpoint publico que suspenda.
    const repository = app.get<AccountRepositoryPort>(ACCOUNT_REPOSITORY)
    await repository.save(
      buildActiveAccount({
        id: 'acc-suspendida',
        subject: 'sub:carla@nexus.test',
        email: 'carla@nexus.test',
        displayName: 'Carla Suspendida',
      }),
    )
    const suspendida = await repository.findBySubject('sub:carla@nexus.test')
    if (suspendida === null) {
      throw new Error('No se pudo preparar la cuenta suspendida para CA-01.')
    }
    suspendida.suspend()
    await repository.save(suspendida)
  })

  afterAll(async () => {
    await app.close()

    for (const [key, value] of Object.entries(previousEnv)) {
      process.env[key] = value ?? ''
    }
  })

  const getOwn = () =>
    request(app.getHttpServer())
      .get('/api/accounts/me')
      .set('authorization', bearer('token-jugador'))

  describe('PATCH /api/accounts/me', () => {
    it('guarda país propio normalizado y permite borrarlo sin cambiar el apodo ni otra cuenta', async () => {
      const before = await getOwn()
      expect(before.body.countryCode).toBeNull()
      const otherBefore = await request(app.getHttpServer())
        .get('/api/accounts/me')
        .set('authorization', bearer('token-jugador-b'))
      const saved = await request(app.getHttpServer())
        .patch('/api/accounts/me')
        .set('authorization', bearer('token-jugador'))
        .send({ countryCode: ' co ' })
        .expect(200)
      expect(saved.body).toEqual({ ...before.body, countryCode: 'CO' })
      expect((await getOwn()).body.countryCode).toBe('CO')
      const otherAfter = await request(app.getHttpServer())
        .get('/api/accounts/me')
        .set('authorization', bearer('token-jugador-b'))
      expect(otherAfter.body).toEqual(otherBefore.body)
      const cleared = await request(app.getHttpServer())
        .patch('/api/accounts/me')
        .set('authorization', bearer('token-jugador'))
        .send({ countryCode: null })
        .expect(200)
      expect(cleared.body).toEqual(before.body)
    })

    it.each([
      { countryCode: 'ZZ' },
      { countryCode: 57 },
      { countryCode: '' },
      { displayName: null },
      {},
      { countryCode: 'CO', subject: 'sub:beatriz@nexus.test' },
    ])('rechaza perfil inválido o cambio de titular %j', async (body) => {
      const before = await getOwn()
      await request(app.getHttpServer())
        .patch('/api/accounts/me')
        .set('authorization', bearer('token-jugador'))
        .send(body)
        .expect(400)
      expect((await getOwn()).body).toEqual(before.body)
    })

    it('responde 401 sin testimonio', async () => {
      const response = await request(app.getHttpServer())
        .patch('/api/accounts/me')
        .send({ displayName: 'Sin Testimonio' })

      expect(response.status).toBe(401)
    })

    it('rechaza un campo no declarado en el contrato', async () => {
      const response = await request(app.getHttpServer())
        .patch('/api/accounts/me')
        .set('authorization', bearer('token-jugador'))
        .send({ displayName: 'Ana Con Extra', unexpected: 'x' })

      expect(response.status).toBe(400)
    })

    it.each(['accountId', 'id', 'subject', 'roles', 'status', 'termsAccepted'])(
      'rechaza el intento de tocar la propiedad interna "%s"',
      async (campo) => {
        const before = await getOwn()

        const response = await request(app.getHttpServer())
          .patch('/api/accounts/me')
          .set('authorization', bearer('token-jugador'))
          .send({ displayName: 'Ana Mass Assignment', [campo]: 'inyectado' })

        expect(response.status).toBe(400)

        const after = await getOwn()
        expect(after.body).toEqual(before.body)
      },
    )

    it('rechaza un apodo con formato invalido', async () => {
      const response = await request(app.getHttpServer())
        .patch('/api/accounts/me')
        .set('authorization', bearer('token-jugador'))
        .send({ displayName: 'ab' })

      expect(response.status).toBe(400)
    })

    it('rechaza un apodo bloqueado por la lista negra', async () => {
      const response = await request(app.getHttpServer())
        .patch('/api/accounts/me')
        .set('authorization', bearer('token-jugador'))
        .send({ displayName: 'admin' })

      expect(response.status).toBe(400)
    })

    it('responde 409 con un apodo que ya usa otra cuenta', async () => {
      const response = await request(app.getHttpServer())
        .patch('/api/accounts/me')
        .set('authorization', bearer('token-jugador'))
        .send({ displayName: 'Nombre Ocupado' })

      expect(response.status).toBe(409)
    })

    it('acepta la edicion idempotente del mismo apodo', async () => {
      const current = (await getOwn()).body as { displayName: string }

      const response = await request(app.getHttpServer())
        .patch('/api/accounts/me')
        .set('authorization', bearer('token-jugador'))
        .send({ displayName: current.displayName })

      expect(response.status).toBe(200)
      expect(response.body.displayName).toBe(current.displayName)
    })

    it('actualiza el apodo, preserva el resto y se ve en una consulta posterior', async () => {
      const before = (await getOwn()).body as { id: string; roles: string[]; status: string }

      const response = await request(app.getHttpServer())
        .patch('/api/accounts/me')
        .set('authorization', bearer('token-jugador'))
        .send({ displayName: 'Ana Actualizada' })

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        id: before.id,
        displayName: 'Ana Actualizada',
        roles: before.roles,
        status: before.status,
        email: 'ana@nexus.test',
      })
      expect(response.body).not.toHaveProperty('subject')

      const after = await getOwn()
      expect(after.body.displayName).toBe('Ana Actualizada')
      expect(after.body.id).toBe(before.id)
    })
  })

  describe('POST /api/accounts/me/password', () => {
    it('responde 401 sin testimonio', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/accounts/me/password')
        .send({ currentPassword: CURRENT_PASSWORD, newPassword: 'Contrasena-Nueva-Ficticia-1' })

      expect(response.status).toBe(401)
    })

    it('rechaza una peticion sin la contrasena nueva', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/accounts/me/password')
        .set('authorization', bearer('token-jugador'))
        .send({ currentPassword: CURRENT_PASSWORD })

      expect(response.status).toBe(400)
    })

    it('rechaza un campo no declarado (accountId)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/accounts/me/password')
        .set('authorization', bearer('token-jugador'))
        .send({
          currentPassword: CURRENT_PASSWORD,
          newPassword: 'Contrasena-Nueva-Ficticia-1',
          accountId: 'acc-ajena',
        })

      expect(response.status).toBe(400)
    })

    it('responde 400 cuando la contrasena actual no es correcta', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/accounts/me/password')
        .set('authorization', bearer('token-jugador'))
        .send({ currentPassword: 'no-es-la-actual', newPassword: 'Contrasena-Nueva-Ficticia-1' })

      expect(response.status).toBe(400)
      expect(JSON.stringify(response.body)).not.toContain('Contrasena-Nueva-Ficticia-1')
    })

    it('responde 400 cuando la contrasena nueva no cumple la politica del proveedor', async () => {
      // La politica de fortaleza es del proveedor: el DTO solo valida forma. El
      // doble fuerza el rechazo del proveedor de forma explicita, sin longitudes.
      passwords.simulateWeakPassword(true)

      try {
        const response = await request(app.getHttpServer())
          .post('/api/accounts/me/password')
          .set('authorization', bearer('token-jugador'))
          .send({
            currentPassword: CURRENT_PASSWORD,
            newPassword: 'Contrasena-Nueva-Cualquiera',
          })

        expect(response.status).toBe(400)
      } finally {
        passwords.simulateWeakPassword(false)
      }
    })

    it('responde 503 cuando el proveedor no responde', async () => {
      passwords.simulateProviderDown(true)

      try {
        const response = await request(app.getHttpServer())
          .post('/api/accounts/me/password')
          .set('authorization', bearer('token-jugador'))
          .send({ currentPassword: CURRENT_PASSWORD, newPassword: 'Contrasena-Nueva-Ficticia-2' })

        expect(response.status).toBe(503)
      } finally {
        passwords.simulateProviderDown(false)
      }
    })

    it('cambia la contrasena y responde 204 sin cuerpo ni credenciales', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/accounts/me/password')
        .set('authorization', bearer('token-jugador'))
        .send({
          currentPassword: CURRENT_PASSWORD,
          newPassword: 'Contrasena-Nueva-Ficticia-1',
        })

      expect(response.status).toBe(204)
      expect(response.text).toBe('')
      expect(JSON.stringify(response.body)).not.toContain('Contrasena-Nueva-Ficticia-1')
    })
  })

  /**
   * CA-08: aislamiento entre titulares. Dos cuentas POBLADAS y dos identidades
   * AUTENTICABLES (A = 'ana@nexus.test', B = 'beatriz@nexus.test'). Cada
   * operacion self-service actua unicamente sobre la cuenta del testimonio y
   * nunca alcanza la del otro titular, en los tres endpoints de HU-05.
   */
  describe('CA-08 aislamiento entre titulares (Usuario A y Usuario B)', () => {
    const meWith = (token: string) =>
      request(app.getHttpServer()).get('/api/accounts/me').set('authorization', bearer(token))

    it('GET /api/accounts/me: cada testimonio devuelve su propia cuenta y nunca la del otro', async () => {
      const a = await meWith('token-jugador')
      const b = await meWith('token-jugador-b')

      expect(a.status).toBe(200)
      expect(a.body).toMatchObject({ email: 'ana@nexus.test' })
      expect(b.status).toBe(200)
      expect(b.body).toMatchObject({ email: 'beatriz@nexus.test' })

      expect(a.body.id).not.toBe(b.body.id)
      expect(JSON.stringify(a.body)).not.toContain('beatriz@nexus.test')
      expect(JSON.stringify(b.body)).not.toContain('ana@nexus.test')
    })

    it('PATCH /api/accounts/me de A cambia solo A y deja intacta la cuenta de B', async () => {
      const bBefore = await meWith('token-jugador-b')

      const patched = await request(app.getHttpServer())
        .patch('/api/accounts/me')
        .set('authorization', bearer('token-jugador'))
        .send({ displayName: 'Ana Solo A' })

      expect(patched.status).toBe(200)
      expect(patched.body).toMatchObject({ email: 'ana@nexus.test', displayName: 'Ana Solo A' })

      const aAfter = await meWith('token-jugador')
      const bAfter = await meWith('token-jugador-b')

      expect(aAfter.body.displayName).toBe('Ana Solo A')
      expect(bAfter.body).toEqual(bBefore.body)
    })

    it('POST /api/accounts/me/password de A actua solo sobre A: la credencial de B sigue sirviendo', async () => {
      // Se reafirma la credencial vigente de cada titular: el doble la retiene
      // por testimonio, y pruebas anteriores mutaron la de 'token-jugador'.
      passwords.seed('token-jugador', 'Cred-A-Vigente-1')
      passwords.seed('token-jugador-b', CURRENT_PASSWORD_B)

      const changedA = await request(app.getHttpServer())
        .post('/api/accounts/me/password')
        .set('authorization', bearer('token-jugador'))
        .send({ currentPassword: 'Cred-A-Vigente-1', newPassword: 'Cred-A-Nueva-1' })
      expect(changedA.status).toBe(204)

      // A si cambio: su credencial anterior ya no vale.
      const reusaViejaA = await request(app.getHttpServer())
        .post('/api/accounts/me/password')
        .set('authorization', bearer('token-jugador'))
        .send({ currentPassword: 'Cred-A-Vigente-1', newPassword: 'Cred-A-Nueva-2' })
      expect(reusaViejaA.status).toBe(400)

      // B no se toco: su credencial original sigue aceptandose.
      const changedB = await request(app.getHttpServer())
        .post('/api/accounts/me/password')
        .set('authorization', bearer('token-jugador-b'))
        .send({ currentPassword: CURRENT_PASSWORD_B, newPassword: 'Cred-B-Nueva-1' })
      expect(changedB.status).toBe(204)
    })
  })

  /**
   * CA-01: GET /api/accounts/me devuelve la cuenta del titular con su estado
   * real -no la oculta ni la niega- sea cual sea su punto del ciclo de vida.
   * Aqui se fijan de forma explicita los dos estados no ACTIVE
   * (`PENDING_VERIFICATION` y `SUSPENDED`), que ninguna prueba comprobaba.
   */
  describe('CA-01 GET /api/accounts/me expone el estado de la cuenta', () => {
    it('devuelve 200 y PENDING_VERIFICATION para una cuenta que aun no confirma el correo', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/accounts/me')
        .set('authorization', bearer('token-jugador-b'))

      expect(response.status).toBe(200)
      expect(response.body.status).toBe('PENDING_VERIFICATION')
    })

    it('devuelve 200 y SUSPENDED para una cuenta suspendida', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/accounts/me')
        .set('authorization', bearer('token-suspendida'))

      expect(response.status).toBe(200)
      expect(response.body.status).toBe('SUSPENDED')
    })
  })
})
