import 'reflect-metadata'

import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../../src/infrastructure/bootstrap/app.module'
import { Role } from '../../src/domain/entities/Role'
import { registerAccountRequest } from '../support/http-register'
import {
  TOKEN_VERIFIER,
  TokenVerificationError,
  type TokenVerifierPort,
  type VerifiedIdentity,
} from '../../src/application/ports/TokenVerifierPort'
import { IDENTITY_SIGN_UP } from '../../src/application/ports/IdentitySignUpPort'
import { ROLE_DIRECTORY, RoleDirectoryError } from '../../src/application/ports/RoleDirectoryPort'
import { InMemoryIdentitySignUp } from '../../src/adapters/outbound/identity/InMemoryIdentitySignUp'
import { InMemoryRoleDirectory } from '../../src/adapters/outbound/identity/InMemoryRoleDirectory'
import { MFA_STATUS } from '../../src/application/ports/MfaStatusPort'
import { SESSION_REVOCATION } from '../../src/application/ports/SessionRevocationPort'
import { ACCOUNT_REPOSITORY } from '../../src/application/ports/AccountRepositoryPort'
import type { AccountRepositoryPort } from '../../src/application/ports/AccountRepositoryPort'
import { InMemoryMfaStatus } from '../../src/adapters/outbound/identity/InMemoryMfaStatus'
import { InMemorySessionRevocation } from '../../src/adapters/outbound/identity/InMemorySessionRevocation'
import { buildActiveAccount } from '../support/account-factory'

/**
 * Integracion con la autenticacion ACTIVA.
 *
 * Se levanta la aplicacion real con `AUTH_MODE=jwt`, de modo que los guards se
 * registran de verdad. Lo unico que se sustituye es el verificador: emitir
 * tokens autenticos exigiria un pool de Cognito real, y eso convertiria una
 * prueba de autorizacion en una prueba de red.
 *
 * Lo que se ejercita es exactamente lo que puede fallar en produccion: que una
 * ruta protegida responda sin testimonio, o que una operacion de administrador
 * la ejecute quien no lo es.
 */

/** Tokens reconocidos por el verificador de prueba. Fuera de estos, todo falla. */
const IDENTITIES: Readonly<Record<string, VerifiedIdentity>> = {
  // El sujeto del token es el que el alta deriva del correo (`sub:<correo>`),
  // para que /me encuentre la cuenta de 'ana@nexus.test' creada en beforeAll.
  'token-jugador': {
    subject: 'sub:ana@nexus.test',
    roles: new Set([Role.Player]),
  },
  'token-moderador': {
    subject: 'sujeto-moderador',
    roles: new Set([Role.Player, Role.Moderator]),
  },
  'token-administrador': {
    subject: 'sujeto-administrador',
    roles: new Set([Role.Player, Role.Administrator]),
  },
  'token-super-administrador': {
    subject: 'sujeto-super-administrador',
    roles: new Set([Role.Player, Role.SuperAdministrator]),
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

describe('API de cuentas con autenticacion activa', () => {
  let app: INestApplication
  let previousEnv: Record<string, string | undefined>
  let accountId: string

  beforeAll(async () => {
    // La configuracion se lee al construir el modulo, asi que el entorno debe
    // estar puesto antes de compilarlo.
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
      // El alta no debe hablar con un pool real: el doble deriva `sub:<correo>`,
      // que es el mismo sujeto que llevan los tokens de este arnes.
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

    await app.get<AccountRepositoryPort>(ACCOUNT_REPOSITORY).save(
      buildActiveAccount({
        id: 'super-administrador',
        subject: 'sujeto-super-administrador',
        email: 'super@nexus.test',
        displayName: 'Super Root',
        roles: [Role.Player, Role.SuperAdministrator],
      }),
    )

    // El alta es PUBLICA: no lleva testimonio. La identidad la crea el propio
    // endpoint en el proveedor (el doble deriva `sub:ana@nexus.test`).
    const created = await registerAccountRequest(app, {
      email: 'ana@nexus.test',
      nickname: 'Ana Ramirez',
    })

    // Se deja PENDING a proposito: el test de autorizacion por rol la activa
    // usando la verificacion administrativa. GET /me y la lectura por
    // administrador no necesitan que este activa.
    accountId = (created.body as { id: string }).id
  })

  afterAll(async () => {
    await app.close()

    // Se restaura asignando en lugar de borrando: `delete` sobre una clave
    // calculada esta prohibido por la configuracion de lint, y dejar la
    // variable vacia equivale a no tenerla para `loadConfig`.
    for (const [key, value] of Object.entries(previousEnv)) {
      process.env[key] = value ?? ''
    }
  })

  const bearer = (token: string) => `Bearer ${token}`

  describe('Rutas publicas', () => {
    /**
     * El registro es PUBLICO: quien se registra todavia no tiene identidad, y
     * este endpoint la crea en el proveedor (ADR-004, "Alta server-side"). La
     * cuenta nace pendiente hasta que se confirma el correo.
     */
    it('el registro es publico y la cuenta nace pendiente de confirmar', async () => {
      const response = await registerAccountRequest(app, {
        email: 'nueva@nexus.test',
        nickname: 'Persona Nueva',
      })

      expect(response.status).toBe(201)
      expect(response.body).toMatchObject({ status: 'PENDING_VERIFICATION' })
    })

    it('confirma el correo con el codigo y activa la cuenta', async () => {
      await registerAccountRequest(app, {
        email: 'confirma@nexus.test',
        nickname: 'Cuenta Confirma',
      })

      const ok = await request(app.getHttpServer())
        .post('/api/accounts/confirmation')
        .send({ identifier: 'confirma@nexus.test', code: '000000' })

      expect(ok.status).toBe(200)
      expect(ok.body).toMatchObject({ status: 'ACTIVE' })
    })

    it('un codigo invalido no activa la cuenta', async () => {
      await registerAccountRequest(app, {
        email: 'malcodigo@nexus.test',
        nickname: 'Cuenta Mal Codigo',
      })

      const bad = await request(app.getHttpServer())
        .post('/api/accounts/confirmation')
        .send({ identifier: 'malcodigo@nexus.test', code: '999999' })

      expect(bad.status).toBe(400)
    })

    /**
     * El registro falla cerrado cuando el rol no se puede reflejar, y eso es
     * deliberado: guardar una cuenta cuyo rol no viajaria en el testimonio es
     * la divergencia que el reflejo existe para impedir.
     *
     * Lo que fija esta prueba es COMO se cuenta ese fallo: 503 y no 500. El
     * servicio funciona, la dependencia no, y reintentar mas tarde tiene
     * sentido.
     */
    it('responde 503, y no 500, cuando el reflejo del rol no responde', async () => {
      const directorio = app.get<{ reflect: () => Promise<void> }>(ROLE_DIRECTORY)
      const original = directorio.reflect
      directorio.reflect = () => Promise.reject(new RoleDirectoryError('el proveedor no responde'))

      try {
        const response = await registerAccountRequest(app, {
          email: 'sin-proveedor@nexus.test',
          nickname: 'Cuenta Sin Proveedor',
        })

        expect(response.status).toBe(503)
        expect(response.body.message).not.toMatch(/internal/i)
      } finally {
        directorio.reflect = original
      }
    })

    it.each(['/api/health/live', '/api/health/ready'])(
      'la sonda %s responde sin testimonio',
      async (path) => {
        const response = await request(app.getHttpServer()).get(path)

        expect(response.status).toBeLessThan(400)
      },
    )
  })

  describe('Rutas protegidas', () => {
    it('responde 401 sin cabecera de autorizacion', async () => {
      const response = await request(app.getHttpServer()).get(`/api/accounts/${accountId}`)

      expect(response.status).toBe(401)
    })

    it('responde 401 con un testimonio que no verifica', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/accounts/${accountId}`)
        .set('Authorization', bearer('token-falsificado'))

      expect(response.status).toBe(401)
    })

    /**
     * Leer una cuenta ARBITRARIA por su identificador interno exige rol de
     * administrador. Una persona no necesita esta ruta para leer la suya: para
     * eso esta `/me`, que no obliga a conocer ni a exponer identificadores.
     */
    it('responde 403 a un jugador que lee una cuenta por su identificador', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/accounts/${accountId}`)
        .set('Authorization', bearer('token-jugador'))

      expect(response.status).toBe(403)
    })

    it('permite a un administrador leer cualquier cuenta', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/accounts/${accountId}`)
        .set('Authorization', bearer('token-administrador'))

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ email: 'ana@nexus.test' })
    })

    it('un SUPER_ADMINISTRATOR puro satisface una ruta ADMINISTRATOR', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/accounts/${accountId}`)
        .set('Authorization', bearer('token-super-administrador'))

      expect(response.status).toBe(200)
    })
  })

  describe('Gestion de roles HU-39', () => {
    const search = () => `/api/accounts/search?email=${encodeURIComponent('ana@nexus.test')}`

    it('protege la busqueda con SUPER_ADMINISTRATOR en un solo sentido', async () => {
      expect((await request(app.getHttpServer()).get(search())).status).toBe(401)

      for (const token of ['token-jugador', 'token-moderador', 'token-administrador']) {
        const response = await request(app.getHttpServer())
          .get(search())
          .set('Authorization', bearer(token))

        expect(response.status).toBe(403)
      }
    })

    it('resuelve search antes que :id y devuelve el estado TOTP', async () => {
      const response = await request(app.getHttpServer())
        .get(search())
        .set('Authorization', bearer('token-super-administrador'))

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        id: accountId,
        email: 'ana@nexus.test',
        mfaEnrolled: false,
      })
    })

    it('solo el Super Administrador concede MODERATOR', async () => {
      const denied = await request(app.getHttpServer())
        .post(`/api/accounts/${accountId}/roles`)
        .set('Authorization', bearer('token-administrador'))
        .send({ role: Role.Moderator })
      expect(denied.status).toBe(403)

      const allowed = await request(app.getHttpServer())
        .post(`/api/accounts/${accountId}/roles`)
        .set('Authorization', bearer('token-super-administrador'))
        .send({ role: Role.Moderator })
      expect(allowed.status).toBe(200)
      expect(allowed.body.roles).toContain(Role.Moderator)
    })

    it('rechaza ADMINISTRATOR sin TOTP y no acepta roles fuera del vocabulario', async () => {
      const noMfa = await request(app.getHttpServer())
        .post(`/api/accounts/${accountId}/roles`)
        .set('Authorization', bearer('token-super-administrador'))
        .send({ role: Role.Administrator })
      expect(noMfa.status).toBe(409)
      expect(noMfa.body.message).toMatch(/aplicacion autenticadora/)

      for (const role of [Role.SuperAdministrator, 'INVENTADO']) {
        const response = await request(app.getHttpServer())
          .post(`/api/accounts/${accountId}/roles`)
          .set('Authorization', bearer('token-super-administrador'))
          .send({ role })

        expect(response.status).toBe(400)
      }
    })

    it('rechaza retirar PLAYER', async () => {
      const response = await request(app.getHttpServer())
        .delete(`/api/accounts/${accountId}/roles/${Role.Player}`)
        .set('Authorization', bearer('token-super-administrador'))

      expect(response.status).toBe(400)
    })
  })

  describe('La propia cuenta se resuelve por el sujeto del testimonio', () => {
    it('responde 401 sin testimonio', async () => {
      expect((await request(app.getHttpServer()).get('/api/accounts/me')).status).toBe(401)
    })

    it('devuelve la cuenta vinculada al sujeto', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/accounts/me')
        .set('Authorization', bearer('token-jugador'))

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ email: 'ana@nexus.test' })
    })

    /**
     * Este es el arreglo, expresado como prueba: un testimonio valido de OTRA
     * persona no alcanza la cuenta de la primera. Antes, cualquier testimonio
     * valido servia para leer cualquier cuenta.
     */
    it('no devuelve la cuenta de otra persona a quien no la posee', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/accounts/me')
        .set('Authorization', bearer('token-administrador'))

      expect(response.status).toBe(404)
    })

    it('la ruta literal `me` no la captura el parametro de identificador', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/accounts/me')
        .set('Authorization', bearer('token-jugador'))

      expect(response.status).not.toBe(403)
    })
  })

  describe('Autorizacion por rol', () => {
    const verificationPath = (): string => `/api/accounts/${accountId}/verification`

    it('responde 401 sin testimonio', async () => {
      const response = await request(app.getHttpServer()).post(verificationPath())

      expect(response.status).toBe(401)
    })

    it.each([
      ['un jugador', 'token-jugador'],
      ['un moderador', 'token-moderador'],
    ])('responde 403 cuando lo intenta %s', async (_quien, token) => {
      const response = await request(app.getHttpServer())
        .post(verificationPath())
        .set('Authorization', bearer(token))

      expect(response.status).toBe(403)
    })

    it('permite la verificacion a un administrador', async () => {
      const response = await request(app.getHttpServer())
        .post(verificationPath())
        .set('Authorization', bearer('token-administrador'))

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ status: 'ACTIVE' })
    })

    /**
     * El moderador tiene un rol elevado, pero no el exigido. Es el caso que
     * distingue "tiene algun rol" de "tiene ESTE rol", y el que se cuela cuando
     * la comprobacion se escribe como "tiene mas de un rol".
     */
    it('no confunde un rol elevado cualquiera con el rol exigido', async () => {
      const response = await request(app.getHttpServer())
        .post(verificationPath())
        .set('Authorization', bearer('token-moderador'))

      expect(response.status).toBe(403)
      expect(response.body).not.toMatchObject({ status: 'ACTIVE' })
    })
  })
})
