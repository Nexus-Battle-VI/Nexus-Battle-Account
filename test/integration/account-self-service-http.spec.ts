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
import {
  PLAYER_INVENTORY_REPORT,
  type PlayerInventoryReportPort,
  type PlayerInventoryReportResult,
} from '../../src/application/ports/PlayerInventoryReportPort'
import {
  COMMUNITY_REPORT,
  type CommunityReportPort,
  type CommunityReportResult,
} from '../../src/application/ports/CommunityReportPort'
import {
  COMMERCE_REPORT,
  type CommerceReportPort,
  type CommerceReportResult,
} from '../../src/application/ports/CommerceReportPort'
import { ACCOUNT_REPOSITORY } from '../../src/application/ports/AccountRepositoryPort'
import { CLOCK, type ClockPort } from '../../src/application/ports/ClockPort'
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
const EXPORT_GENERATED_AT = '2026-09-02T18:45:30.000Z'
const fixedClock: ClockPort = { now: () => new Date(EXPORT_GENERATED_AT) }

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
  // Testimonio valido sin cuenta local asociada: HU-45.1 debe cerrar con 404
  // generico y sin filtrar el subject del proveedor de identidad.
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

/**
 * Dobles de los tres puertos de lectura del reporte PDF (HU-45.3). Registran
 * el testimonio con el que se les llamo, para comprobar que Account reenvia
 * el mismo testimonio del titular sin construir ningun identificador propio.
 */
class FakePlayerInventoryReport implements PlayerInventoryReportPort {
  result: PlayerInventoryReportResult = {
    available: true,
    items: [{ reference: 'espada-de-hierro', name: 'Espada de Hierro', quantity: 1 }],
  }
  lastAccessToken: string | null = null

  listOwnItems(accessToken: string): Promise<PlayerInventoryReportResult> {
    this.lastAccessToken = accessToken

    return Promise.resolve(this.result)
  }
}

class FakeCommunityReport implements CommunityReportPort {
  result: CommunityReportResult = {
    available: true,
    posts: [
      {
        id: 'post-1',
        threadId: 'thread-1',
        content: 'Buen combate',
        createdAt: EXPORT_GENERATED_AT,
      },
    ],
  }
  lastAccessToken: string | null = null

  listOwnPosts(accessToken: string): Promise<CommunityReportResult> {
    this.lastAccessToken = accessToken

    return Promise.resolve(this.result)
  }
}

class FakeCommerceReport implements CommerceReportPort {
  result: CommerceReportResult = {
    available: true,
    orders: [{ id: 'ord-1', status: 'CONFIRMED', currency: 'COP', total: 30000, itemCount: 2 }],
  }
  lastAccessToken: string | null = null

  listOwnOrders(accessToken: string): Promise<CommerceReportResult> {
    this.lastAccessToken = accessToken

    return Promise.resolve(this.result)
  }
}

describe('API self-service de la cuenta propia (HU-05)', () => {
  let app: INestApplication
  let previousEnv: Record<string, string | undefined>
  let beatrizAccountId: string
  const passwords = new InMemoryPasswordChange()
  const inventoryReport = new FakePlayerInventoryReport()
  const communityReport = new FakeCommunityReport()
  const commerceReport = new FakeCommerceReport()

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
      .overrideProvider(CLOCK)
      .useValue(fixedClock)
      .overrideProvider(PLAYER_INVENTORY_REPORT)
      .useValue(inventoryReport)
      .overrideProvider(COMMUNITY_REPORT)
      .useValue(communityReport)
      .overrideProvider(COMMERCE_REPORT)
      .useValue(commerceReport)
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
    const beatriz = await registerAccountRequest(app, {
      email: 'beatriz@nexus.test',
      nickname: 'Beatriz Lopez',
    })
    beatrizAccountId = String(beatriz.body.id)

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

  const getOwnPrivacy = (token = 'token-jugador') =>
    request(app.getHttpServer()).get('/api/accounts/me/privacy').set('authorization', bearer(token))

  describe('GET /api/accounts/me/privacy', () => {
    it('devuelve los datos personales permitidos del titular autenticado', async () => {
      const response = await getOwnPrivacy()

      expect(response.status).toBe(200)
      expect(response.body).toEqual({
        email: 'ana@nexus.test',
        displayName: 'Ana Ramirez',
        firstNames: 'Ana',
        lastNames: 'Ramirez',
        roles: [Role.Player],
        termsAccepted: true,
      })
    })

    it('responde 401 sin testimonio', async () => {
      const response = await request(app.getHttpServer()).get('/api/accounts/me/privacy')

      expect(response.status).toBe(401)
    })

    it('resuelve siempre la cuenta del subject del JWT y mantiene aislamiento A/B', async () => {
      const a = await getOwnPrivacy('token-jugador')
      const b = await getOwnPrivacy('token-jugador-b')

      expect(a.status).toBe(200)
      expect(b.status).toBe(200)
      expect(a.body).toMatchObject({ email: 'ana@nexus.test' })
      expect(b.body).toMatchObject({ email: 'beatriz@nexus.test' })
      expect(JSON.stringify(a.body)).not.toContain('beatriz@nexus.test')
      expect(JSON.stringify(b.body)).not.toContain('ana@nexus.test')
    })

    it('ignora accountId en query y no permite leer otra cuenta', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/accounts/me/privacy?accountId=${beatrizAccountId}`)
        .set('authorization', bearer('token-jugador'))

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ email: 'ana@nexus.test' })
      expect(JSON.stringify(response.body)).not.toContain('beatriz@nexus.test')
    })

    it('no expone campos sensibles ni internos', async () => {
      const response = await getOwnPrivacy()

      expect(response.status).toBe(200)
      expect(Object.keys(response.body).sort()).toEqual([
        'displayName',
        'email',
        'firstNames',
        'lastNames',
        'roles',
        'termsAccepted',
      ])
      for (const field of [
        'id',
        'subject',
        'status',
        'avatarStorageKey',
        'password',
        'token',
        'secret',
        'hash',
        'credential',
      ]) {
        expect(response.body).not.toHaveProperty(field)
      }
    })

    it('responde 404 sin filtrar el subject cuando el testimonio no tiene cuenta local', async () => {
      const response = await getOwnPrivacy('token-sin-cuenta')

      expect(response.status).toBe(404)
      expect(JSON.stringify(response.body)).not.toContain('sub:sin-cuenta@nexus.test')
      expect(JSON.stringify(response.body)).not.toContain('ana@nexus.test')
      expect(JSON.stringify(response.body)).not.toContain('beatriz@nexus.test')
    })
  })

  describe('GET /api/accounts/me/privacy/export', () => {
    const exportPrivacy = (format: string, token = 'token-jugador') =>
      request(app.getHttpServer())
        .get(`/api/accounts/me/privacy/export?format=${format}`)
        .set('authorization', bearer(token))

    it('descarga JSON canónico del titular autenticado', async () => {
      const response = await exportPrivacy('json')

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toBe('application/json; charset=utf-8')
      expect(response.headers['content-disposition']).toBe(
        'attachment; filename="nexus-battles-personal-data.json"',
      )
      expect(response.body).toEqual({
        schemaVersion: '1.0',
        generatedAt: EXPORT_GENERATED_AT,
        personalData: {
          email: 'ana@nexus.test',
          displayName: 'Ana Ramirez',
          firstNames: 'Ana',
          lastNames: 'Ramirez',
          roles: [Role.Player],
          termsAccepted: true,
        },
      })
    })

    it('descarga XML equivalente con UTF-8 y datos escapados', async () => {
      const response = await exportPrivacy('xml')

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toBe('application/xml; charset=utf-8')
      expect(response.headers['content-disposition']).toBe(
        'attachment; filename="nexus-battles-personal-data.xml"',
      )
      expect(response.text).toContain('<privacyExport schemaVersion="1.0">')
      expect(response.text).toContain(`<generatedAt>${EXPORT_GENERATED_AT}</generatedAt>`)
      expect(response.text).toContain('<email>ana@nexus.test</email>')
      expect(response.text).toContain('<role>PLAYER</role>')
      expect(response.text).toContain('<termsAccepted>true</termsAccepted>')
    })

    describe('format=pdf (HU-45.3, Management #135)', () => {
      afterEach(() => {
        inventoryReport.result = {
          available: true,
          items: [{ reference: 'espada-de-hierro', name: 'Espada de Hierro', quantity: 1 }],
        }
        communityReport.result = {
          available: true,
          posts: [
            {
              id: 'post-1',
              threadId: 'thread-1',
              content: 'Buen combate',
              createdAt: EXPORT_GENERATED_AT,
            },
          ],
        }
        commerceReport.result = {
          available: true,
          orders: [
            { id: 'ord-1', status: 'CONFIRMED', currency: 'COP', total: 30000, itemCount: 2 },
          ],
        }
      })

      it('descarga un PDF real (ya no 503): identidad + inventario + comentarios + transacciones', async () => {
        const response = await exportPrivacy('pdf')

        expect(response.status).toBe(200)
        expect(response.headers['content-type']).toBe('application/pdf')
        expect(response.headers['content-disposition']).toBe(
          'attachment; filename="nexus-battles-privacy-report.pdf"',
        )
        const bytes = response.body as Buffer
        expect(Buffer.isBuffer(bytes)).toBe(true)
        expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
      })

      it('reenvia el testimonio del titular a las tres fuentes externas, sin construir ningun identificador', async () => {
        await exportPrivacy('pdf')

        expect(inventoryReport.lastAccessToken).toBe('token-jugador')
        expect(communityReport.lastAccessToken).toBe('token-jugador')
        expect(commerceReport.lastAccessToken).toBe('token-jugador')
      })

      it('genera el PDF igual cuando una fuente externa no esta disponible: no bloquea el reporte', async () => {
        inventoryReport.result = { available: false, items: [] }

        const response = await exportPrivacy('pdf')

        expect(response.status).toBe(200)
        expect(response.headers['content-type']).toBe('application/pdf')
      })

      it('resuelve el reporte exclusivamente desde el subject verificado, nunca de un identificador del titular ajeno', async () => {
        const a = await exportPrivacy('pdf', 'token-jugador')
        const b = await exportPrivacy('pdf', 'token-jugador-b')

        expect(a.status).toBe(200)
        expect(b.status).toBe(200)
        // Cada peticion reenvio el testimonio de SU PROPIO titular, nunca el ajeno.
        expect(inventoryReport.lastAccessToken).toBe('token-jugador-b')
      })

      it('responde 401 sin testimonio', async () => {
        const response = await request(app.getHttpServer()).get(
          '/api/accounts/me/privacy/export?format=pdf',
        )

        expect(response.status).toBe(401)
      })

      it('no muta la cuenta al generar el PDF', async () => {
        const before = await getOwnPrivacy()

        await exportPrivacy('pdf')

        const after = await getOwnPrivacy()
        expect(after.body).toEqual(before.body)
      })
    })

    it('resuelve exportaciones diferentes exclusivamente desde cada subject verificado', async () => {
      const a = await exportPrivacy('json', 'token-jugador')
      const b = await exportPrivacy('json', 'token-jugador-b')

      expect(a.body.personalData.email).toBe('ana@nexus.test')
      expect(b.body.personalData.email).toBe('beatriz@nexus.test')
      expect(JSON.stringify(a.body)).not.toContain('beatriz@nexus.test')
      expect(JSON.stringify(b.body)).not.toContain('ana@nexus.test')
    })

    it('responde 401 sin testimonio', async () => {
      const response = await request(app.getHttpServer()).get(
        '/api/accounts/me/privacy/export?format=json',
      )

      expect(response.status).toBe(401)
    })

    it.each(['accountId', 'ownerId', 'customerId', 'subject', 'userId'])(
      'rechaza el selector de titular manipulable %s',
      async (selector) => {
        const response = await request(app.getHttpServer())
          .get(`/api/accounts/me/privacy/export?format=json&${selector}=otro-titular`)
          .set('authorization', bearer('token-jugador'))

        expect(response.status).toBe(400)
        expect(JSON.stringify(response.body)).not.toContain('otro-titular')
      },
    )

    it('rechaza formatos no soportados', async () => {
      const response = await exportPrivacy('csv')

      expect(response.status).toBe(400)
    })

    it('no muta la cuenta al exportar JSON y XML', async () => {
      const before = await getOwnPrivacy()

      await exportPrivacy('json')
      await exportPrivacy('xml')

      const after = await getOwnPrivacy()
      expect(after.body).toEqual(before.body)
    })
  })

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
