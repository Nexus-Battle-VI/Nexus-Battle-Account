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
import { TOTP_ENROLLMENT } from '../../src/application/ports/TotpEnrollmentPort'
import { InMemoryTotpEnrollment } from '../../src/adapters/outbound/identity/InMemoryTotpEnrollment'

/**
 * Integracion de la inscripcion TOTP con la autenticacion ACTIVA.
 *
 * El token del arnes cumple dos papeles a la vez, igual que en produccion: el
 * verificador lo acepta como identidad Y el guard lo reenvia crudo al doble de
 * inscripcion. Por eso `enroll` y `verify` con el mismo token se entienden.
 *
 * Es deliberadamente `token-jugador` (rol PLAYER): inscribir el segundo factor
 * NO exige ser administrador. El orden del gobierno es inscribir siendo PLAYER
 * y elevar despues.
 */
const IDENTITIES: Readonly<Record<string, VerifiedIdentity>> = {
  'token-jugador': { subject: 'sub:jugador@nexus.test', roles: new Set([Role.Player]) },
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

describe('API de inscripcion TOTP con autenticacion activa', () => {
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
      // Con `AUTH_MODE=jwt` la raiz elegiria el adaptador real, que hablaria con
      // un pool inexistente. El doble reproduce el contrato (asociar -> confirmar).
      .overrideProvider(TOTP_ENROLLMENT)
      .useValue(new InMemoryTotpEnrollment())
      .compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('api')
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )

    await app.init()
  })

  afterAll(async () => {
    await app.close()
    process.env.AUTH_MODE = previousEnv.AUTH_MODE
    process.env.COGNITO_USER_POOL_ID = previousEnv.COGNITO_USER_POOL_ID
    process.env.COGNITO_CLIENT_ID = previousEnv.COGNITO_CLIENT_ID
  })

  it('POST /api/accounts/mfa/totp responde 401 sin testimonio', async () => {
    const response = await request(app.getHttpServer()).post('/api/accounts/mfa/totp')

    expect(response.status).toBe(401)
  })

  it('un PLAYER asocia un autenticador y recibe el secreto y el otpauth', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/accounts/mfa/totp')
      .set('authorization', bearer('token-jugador'))

    expect(response.status).toBe(200)
    expect(response.body.secret).toBe(InMemoryTotpEnrollment.FIXED_SECRET)
    expect(String(response.body.otpauthUri)).toContain('otpauth://totp/')
  })

  it('confirma con el codigo correcto tras asociar', async () => {
    await request(app.getHttpServer())
      .post('/api/accounts/mfa/totp')
      .set('authorization', bearer('token-jugador'))

    const response = await request(app.getHttpServer())
      .post('/api/accounts/mfa/totp/verification')
      .set('authorization', bearer('token-jugador'))
      .send({ code: InMemoryTotpEnrollment.FIXED_CODE })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'CONFIRMED' })
  })

  it('responde 400 con un codigo que no coincide', async () => {
    await request(app.getHttpServer())
      .post('/api/accounts/mfa/totp')
      .set('authorization', bearer('token-jugador'))

    const response = await request(app.getHttpServer())
      .post('/api/accounts/mfa/totp/verification')
      .set('authorization', bearer('token-jugador'))
      .send({ code: '999999' })

    expect(response.status).toBe(400)
  })

  it('responde 400 ante un codigo con formato invalido (no seis digitos)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/accounts/mfa/totp/verification')
      .set('authorization', bearer('token-jugador'))
      .send({ code: 'abcdef' })

    expect(response.status).toBe(400)
  })

  it('POST /api/accounts/mfa/totp/verification responde 401 sin testimonio', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/accounts/mfa/totp/verification')
      .send({ code: '000000' })

    expect(response.status).toBe(401)
  })
})
