import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../../src/infrastructure/bootstrap/app.module'
import {
  INTERNAL_SERVICE_HEADER,
  INTERNAL_SIGNATURE_HEADER,
  INTERNAL_TIMESTAMP_HEADER,
  signInternalRequest,
} from '../../src/adapters/inbound/http/auth/internal-signature'
import { registerAccountRequest } from '../support/http-register'

/** Secreto FICTICIO, exclusivo de estas pruebas. No existe en ningun entorno. */
const SECRETO = 'secreto-de-pruebas-no-usado-en-ningun-entorno'
const rutaPerfil = (subject: string): string => `/api/internal/accounts/${subject}/battle-profile`

const firmar = (
  path: string,
  overrides: { service?: string; timestamp?: string; signature?: string } = {},
): Record<string, string> => {
  const service = overrides.service ?? 'combat'
  const timestamp = overrides.timestamp ?? String(Date.now())
  const signature =
    overrides.signature ??
    signInternalRequest(SECRETO, { service, method: 'GET', path, timestamp, body: {} })

  return {
    [INTERNAL_SERVICE_HEADER]: service,
    [INTERNAL_TIMESTAMP_HEADER]: timestamp,
    [INTERNAL_SIGNATURE_HEADER]: signature,
  }
}

describe('Contrato interno de perfil de batalla (HU-15/RF-15, DP-2)', () => {
  let app: INestApplication
  let previousEnv: Record<string, string | undefined>

  beforeAll(async () => {
    previousEnv = { ...process.env }
    process.env.PERSISTENCE_DRIVER = 'memory'
    process.env.AUTH_MODE = 'disabled'
    process.env.AUTHENTICATION_DRIVER = 'fake'
    process.env.INTERNAL_SERVICE_AUTH_SECRET = SECRETO
    process.env.INTERNAL_SERVICE_ALLOWED_SERVICES = 'combat'

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('api')
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )
    await app.init()
  })

  afterAll(async () => {
    await app.close()
    process.env = previousEnv
  })

  it('devuelve subject, displayName y avatarUrl de una cuenta existente', async () => {
    const registered = await registerAccountRequest(app, {
      email: 'jugador-batalla@nexus.test',
      nickname: 'Jugador De Batalla',
    })
    expect(registered.status).toBe(201)
    const accountId = String(registered.body.id)

    // `InMemoryIdentitySignUp` (doble de alta con AUTH_MODE=disabled) deriva
    // el sujeto del correo de forma deterministica: `sub:<correo>`.
    const subject = 'sub:jugador-batalla@nexus.test'
    const ruta = rutaPerfil(subject)

    const response = await request(app.getHttpServer()).get(ruta).set(firmar(ruta))

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      subject,
      displayName: 'Jugador De Batalla',
      avatarUrl: `/accounts/${accountId}/avatar`,
    })
  })

  it('responde 404 cuando el sujeto no tiene cuenta en este servicio', async () => {
    const ruta = rutaPerfil('sujeto-sin-cuenta')

    const response = await request(app.getHttpServer()).get(ruta).set(firmar(ruta))

    expect(response.status).toBe(404)
  })

  /**
   * El contrato es MINIMO a proposito: nunca email, roles, pais ni nombre
   * legal. Sin esta prueba, agregar un campo de mas al proyectar la respuesta
   * pasaria inadvertido.
   */
  it('nunca incluye email, roles, countryCode ni nombres legales', async () => {
    await registerAccountRequest(app, {
      email: 'perfil-minimo@nexus.test',
      nickname: 'Perfil Minimo',
    })

    const ruta = rutaPerfil('sub:perfil-minimo@nexus.test')
    const response = await request(app.getHttpServer()).get(ruta).set(firmar(ruta))

    expect(response.status).toBe(200)
    expect(Object.keys(response.body).sort()).toEqual(['avatarUrl', 'displayName', 'subject'])
  })

  it('rechaza una llamada sin autenticacion entre servicios', async () => {
    const ruta = rutaPerfil('anonymous')

    const response = await request(app.getHttpServer()).get(ruta)

    expect(response.status).toBe(401)
  })

  it('rechaza una firma incorrecta', async () => {
    const ruta = rutaPerfil('anonymous')

    const response = await request(app.getHttpServer())
      .get(ruta)
      .set(firmar(ruta, { signature: 'a'.repeat(64) }))

    expect(response.status).toBe(401)
  })

  it('rechaza un servicio que no esta en la lista permitida', async () => {
    const ruta = rutaPerfil('anonymous')

    const response = await request(app.getHttpServer())
      .get(ruta)
      .set(firmar(ruta, { service: 'servicio-no-listado' }))

    expect(response.status).toBe(401)
  })

  it('rechaza un sello de tiempo fuera de la ventana', async () => {
    const ruta = rutaPerfil('anonymous')
    const viejo = String(Date.now() - 600_000)

    const response = await request(app.getHttpServer())
      .get(ruta)
      .set(firmar(ruta, { timestamp: viejo }))

    expect(response.status).toBe(401)
  })

  /**
   * La firma cubre la RUTA, no solo el metodo y el sello de tiempo. Sin esta
   * prueba, una firma valida para el perfil de un sujeto serviria igual para
   * el de cualquier otro con solo cambiar el segmento `:subject` en la URL.
   */
  it('rechaza una firma valida para OTRA ruta (otro sujeto)', async () => {
    const rutaFirmada = rutaPerfil('sujeto-original')
    const rutaLlamada = rutaPerfil('sujeto-suplantado')

    const response = await request(app.getHttpServer()).get(rutaLlamada).set(firmar(rutaFirmada))

    expect(response.status).toBe(401)
  })
})
