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
  'token-jugador': {
    subject: 'sujeto-jugador',
    email: 'jugador@nexus.test',
    roles: new Set([Role.Player]),
  },
  'token-moderador': {
    subject: 'sujeto-moderador',
    email: 'moderador@nexus.test',
    roles: new Set([Role.Player, Role.Moderator]),
  },
  'token-administrador': {
    subject: 'sujeto-administrador',
    email: 'admin@nexus.test',
    roles: new Set([Role.Player, Role.Administrator]),
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
      .compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('api')
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )

    await app.init()

    const created = await registerAccountRequest(app, {
      email: 'ana@nexus.test',
      nickname: 'Ana Ramirez',
    }).set('Authorization', `Bearer token-jugador`)

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
     * El registro exige testimonio, y no es una restriccion arbitraria: con un
     * proveedor real el alta ocurre en su propia pantalla, de modo que al
     * llegar aqui la identidad YA existe y lo que falta es la cuenta del
     * producto.
     */
    it('el registro exige testimonio', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/accounts')
        .send({ email: 'nuevo@nexus.test', nickname: 'Persona Nueva' })

      expect(response.status).toBe(401)
    })

    it('registra la cuenta vinculada al sujeto del testimonio', async () => {
      const response = await registerAccountRequest(app, {
        email: 'moderador@nexus.test',
        nickname: 'Persona Moderadora',
      }).set('Authorization', bearer('token-moderador'))

      expect(response.status).toBe(201)

      // El sujeto NO se expone en la respuesta: es un vinculo interno. Que el
      // vinculo existe se comprueba leyendo /me con el mismo testimonio.
      expect(response.body).not.toHaveProperty('subject')

      const propia = await request(app.getHttpServer())
        .get('/api/accounts/me')
        .set('Authorization', bearer('token-moderador'))

      expect(propia.status).toBe(200)
      expect(propia.body).toMatchObject({ email: 'moderador@nexus.test' })
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
