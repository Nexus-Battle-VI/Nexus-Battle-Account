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
import { ACCOUNT_DELETION_REQUEST_REPOSITORY } from '../../src/application/ports/AccountDeletionRequestRepositoryPort'
import type { AccountDeletionRequestRepositoryPort } from '../../src/application/ports/AccountDeletionRequestRepositoryPort'
import { InMemoryIdentitySignUp } from '../../src/adapters/outbound/identity/InMemoryIdentitySignUp'
import { InMemoryRoleDirectory } from '../../src/adapters/outbound/identity/InMemoryRoleDirectory'
import { InMemoryMfaStatus } from '../../src/adapters/outbound/identity/InMemoryMfaStatus'
import { InMemorySessionRevocation } from '../../src/adapters/outbound/identity/InMemorySessionRevocation'
import { InMemoryPasswordChange } from '../../src/adapters/outbound/identity/InMemoryPasswordChange'
import { buildActiveAccount } from '../support/account-factory'

/**
 * Integracion de HU-43.2 (`POST /api/accounts/me/deletion-requests`) con la
 * autenticacion ACTIVA -mismo patron que `account-self-service-http.spec.ts`
 * (HU-05): se levanta la aplicacion real con `AUTH_MODE=jwt`, de modo que el
 * guard global protege de verdad, y solo se sustituye lo que hablaria con un
 * pool de Cognito real.
 */
const IDENTITIES: Readonly<Record<string, VerifiedIdentity>> = {
  'token-jugador': {
    subject: 'sub:ana@nexus.test',
    roles: new Set([Role.Player]),
    jti: null,
    expiresAt: null,
  },
  'token-jugador-b': {
    subject: 'sub:beatriz@nexus.test',
    roles: new Set([Role.Player]),
    jti: null,
    expiresAt: null,
  },
  // Testimonio valido para el verificador, pero sin cuenta asociada.
  'token-sin-cuenta': {
    subject: 'sub:sin-cuenta@nexus.test',
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

describe('API de solicitud de eliminacion de la cuenta propia (HU-43.2)', () => {
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
      .overrideProvider(ROLE_DIRECTORY)
      .useValue(new InMemoryRoleDirectory())
      .overrideProvider(IDENTITY_SIGN_UP)
      .useValue(new InMemoryIdentitySignUp())
      .overrideProvider(MFA_STATUS)
      .useValue(new InMemoryMfaStatus())
      .overrideProvider(SESSION_REVOCATION)
      .useValue(new InMemorySessionRevocation())
      .overrideProvider(PASSWORD_CHANGE)
      .useValue(new InMemoryPasswordChange())
      .compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('api')
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )

    await app.init()

    const accounts = app.get<AccountRepositoryPort>(ACCOUNT_REPOSITORY)
    await accounts.save(
      buildActiveAccount({
        id: 'acc-propia',
        subject: 'sub:ana@nexus.test',
        email: 'ana@nexus.test',
        displayName: 'Ana Ramirez',
      }),
    )
    await accounts.save(
      buildActiveAccount({
        id: 'acc-ajena',
        subject: 'sub:beatriz@nexus.test',
        email: 'beatriz@nexus.test',
        displayName: 'Beatriz Lopez',
      }),
    )
  })

  afterAll(async () => {
    await app.close()

    for (const [key, value] of Object.entries(previousEnv)) {
      process.env[key] = value ?? ''
    }
  })

  const post = () => request(app.getHttpServer()).post('/api/accounts/me/deletion-requests')

  describe('POST /api/accounts/me/deletion-requests', () => {
    it('responde 401 sin testimonio', async () => {
      const response = await post()

      expect(response.status).toBe(401)
    })

    it('responde 404 cuando el sujeto del testimonio no tiene cuenta en este servicio', async () => {
      const response = await post().set('authorization', bearer('token-sin-cuenta'))

      expect(response.status).toBe(404)
    })

    it('registra la solicitud y confirma RECEPCION, no cierre', async () => {
      const response = await post().set('authorization', bearer('token-jugador'))

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ status: 'RECEIVED' })
      expect(typeof response.body.id).toBe('string')
      expect(typeof response.body.receivedAt).toBe('string')
      // La confirmacion es de recepcion: no hay campo de cierre ni ninguna
      // senal de que el tratamiento ya haya terminado.
      expect(response.body).not.toHaveProperty('closedAt')
    })

    it('ignora cualquier accountId del cuerpo: la solicitud es SIEMPRE sobre el titular del testimonio', async () => {
      const deletionRequests = app.get<AccountDeletionRequestRepositoryPort>(
        ACCOUNT_DELETION_REQUEST_REPOSITORY,
      )

      const response = await post()
        .set('authorization', bearer('token-jugador-b'))
        .send({ accountId: 'acc-propia', subject: 'sub:ana@nexus.test' })

      expect(response.status).toBe(200)

      // La solicitud creada pertenece a Beatriz (el testimonio), nunca a la
      // cuenta ajena que el cuerpo intento nombrar.
      const propia = await deletionRequests.findById(response.body.id as string)
      expect(propia?.accountId).toBe('acc-ajena')
    })

    it('es idempotente por HTTP: repetir la peticion mientras hay una solicitud activa devuelve la MISMA', async () => {
      const primera = await post().set('authorization', bearer('token-jugador'))
      const segunda = await post().set('authorization', bearer('token-jugador'))

      expect(segunda.status).toBe(200)
      expect(segunda.body.id).toBe(primera.body.id)
      expect(segunda.body.receivedAt).toBe(primera.body.receivedAt)
    })
  })
})
