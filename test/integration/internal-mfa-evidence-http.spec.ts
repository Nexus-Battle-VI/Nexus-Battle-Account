import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../../src/infrastructure/bootstrap/app.module'
import { MFA_EVIDENCE_REPOSITORY } from '../../src/application/ports/MfaEvidenceRepositoryPort'
import type { MfaEvidenceRepositoryPort } from '../../src/application/ports/MfaEvidenceRepositoryPort'
import { MfaEvidence } from '../../src/domain/entities/MfaEvidence'
import { SecondFactorMethod } from '../../src/domain/entities/SecondFactorMethod'
import {
  INTERNAL_SERVICE_HEADER,
  INTERNAL_SIGNATURE_HEADER,
  INTERNAL_TIMESTAMP_HEADER,
  signInternalRequest,
} from '../../src/adapters/inbound/http/auth/internal-signature'

/** Secreto FICTICIO, exclusivo de estas pruebas. No existe en ningun entorno. */
const SECRETO = 'secreto-de-pruebas-no-usado-en-ningun-entorno'
const RUTA = '/api/internal/mfa-evidence/verification'
const SUJETO = 'sujeto-con-segundo-factor'
const JTI = 'jti-del-testimonio'
const METODO = SecondFactorMethod.AuthenticatorApp

const firmar = (
  body: unknown,
  overrides: { service?: string; timestamp?: string; signature?: string } = {},
): Record<string, string> => {
  const service = overrides.service ?? 'catalog'
  const timestamp = overrides.timestamp ?? String(Date.now())
  const signature =
    overrides.signature ??
    signInternalRequest(SECRETO, { service, method: 'POST', path: RUTA, timestamp, body })

  return {
    [INTERNAL_SERVICE_HEADER]: service,
    [INTERNAL_TIMESTAMP_HEADER]: timestamp,
    [INTERNAL_SIGNATURE_HEADER]: signature,
  }
}

describe('Contrato interno de evidencia de segundo factor', () => {
  let app: INestApplication
  let previousEnv: Record<string, string | undefined>
  let evidencias: MfaEvidenceRepositoryPort

  beforeAll(async () => {
    previousEnv = { ...process.env }
    process.env.PERSISTENCE_DRIVER = 'memory'
    process.env.AUTH_MODE = 'disabled'
    process.env.AUTHENTICATION_DRIVER = 'fake'
    process.env.INTERNAL_SERVICE_AUTH_SECRET = SECRETO
    process.env.INTERNAL_SERVICE_ALLOWED_SERVICES = 'catalog'

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('api')
    // El mismo pipe que instala `main.ts`: sin el, la prueba no describiria el
    // comportamiento desplegado.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )
    await app.init()

    evidencias = app.get<MfaEvidenceRepositoryPort>(MFA_EVIDENCE_REPOSITORY)
  })

  afterAll(async () => {
    await app.close()
    process.env = previousEnv
  })

  beforeEach(async () => {
    await evidencias.save(
      MfaEvidence.create({
        subject: SUJETO,
        jti: JTI,
        method: METODO,
        expiresAt: new Date(Date.now() + 900_000),
        verifiedAt: new Date(),
      }),
    )
  })

  it('responde valid=true con evidencia vigente y firma correcta', async () => {
    const body = { subject: SUJETO, jti: JTI, method: METODO }

    const response = await request(app.getHttpServer()).post(RUTA).set(firmar(body)).send(body)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ valid: true })
  })

  /**
   * La evidencia muere con el testimonio que la origino. Sin esta comprobacion,
   * una sesion administrativa antigua seguiria autorizando mutaciones.
   */
  it('responde valid=false con evidencia expirada', async () => {
    await evidencias.save(
      MfaEvidence.create({
        subject: 'sujeto-caducado',
        jti: 'jti-caducado',
        method: METODO,
        expiresAt: new Date(Date.now() - 1_000),
        verifiedAt: new Date(Date.now() - 900_000),
      }),
    )

    const body = { subject: 'sujeto-caducado', jti: 'jti-caducado', method: METODO }

    const response = await request(app.getHttpServer()).post(RUTA).set(firmar(body)).send(body)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ valid: false })
  })

  /**
   * Las dos mitades de la clave son necesarias. Con solo el sujeto, un
   * testimonio posterior nacido sin segundo factor heredaria la evidencia.
   */
  it('responde valid=false para el mismo sujeto con otro jti', async () => {
    const body = { subject: SUJETO, jti: 'jti-de-otro-testimonio', method: METODO }

    const response = await request(app.getHttpServer()).post(RUTA).set(firmar(body)).send(body)

    expect(response.body).toEqual({ valid: false })
  })

  it('responde valid=false para el mismo jti con otro sujeto', async () => {
    const body = { subject: 'otro-sujeto', jti: JTI, method: METODO }

    const response = await request(app.getHttpServer()).post(RUTA).set(firmar(body)).send(body)

    expect(response.body).toEqual({ valid: false })
  })

  it('rechaza una llamada sin autenticacion entre servicios', async () => {
    const response = await request(app.getHttpServer())
      .post(RUTA)
      .send({ subject: SUJETO, jti: JTI, method: METODO })

    expect(response.status).toBe(401)
  })

  it('rechaza una firma incorrecta', async () => {
    const body = { subject: SUJETO, jti: JTI, method: METODO }

    const response = await request(app.getHttpServer())
      .post(RUTA)
      .set(firmar(body, { signature: 'a'.repeat(64) }))
      .send(body)

    expect(response.status).toBe(401)
  })

  /**
   * Sin ventana de tiempo, una peticion firmada capturada valdria para siempre.
   */
  it('rechaza un sello de tiempo fuera de la ventana', async () => {
    const body = { subject: SUJETO, jti: JTI, method: METODO }
    const viejo = String(Date.now() - 600_000)

    const response = await request(app.getHttpServer())
      .post(RUTA)
      .set(firmar(body, { timestamp: viejo }))
      .send(body)

    expect(response.status).toBe(401)
  })

  it('rechaza un servicio que no esta en la lista permitida', async () => {
    const body = { subject: SUJETO, jti: JTI, method: METODO }

    const response = await request(app.getHttpServer())
      .post(RUTA)
      .set(firmar(body, { service: 'servicio-no-listado' }))
      .send(body)

    expect(response.status).toBe(401)
  })

  /**
   * CONTROL de los rechazos anteriores: la firma cubre el CUERPO, no solo las
   * cabeceras. Sin esta prueba, «rechaza firma invalida» pasaria igual con una
   * implementacion que firmara unicamente el sello de tiempo, y cualquiera
   * podria reutilizar una firma legitima cambiando a quien consulta.
   */
  it('rechaza una firma valida para OTRO cuerpo', async () => {
    const firmado = { subject: SUJETO, jti: JTI, method: METODO }
    const enviado = { subject: 'sujeto-suplantado', jti: JTI, method: METODO }

    const response = await request(app.getHttpServer())
      .post(RUTA)
      .set(firmar(firmado))
      .send(enviado)

    expect(response.status).toBe(401)
  })

  it('rechaza un cuerpo sin los campos del contrato', async () => {
    const body = { subject: SUJETO }

    const response = await request(app.getHttpServer()).post(RUTA).set(firmar(body)).send(body)

    expect(response.status).toBe(400)
  })

  it('responde valid=false cuando el metodo no coincide con la evidencia', async () => {
    const body = { subject: SUJETO, jti: JTI, method: SecondFactorMethod.Email }

    const response = await request(app.getHttpServer()).post(RUTA).set(firmar(body)).send(body)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ valid: false })
  })

  it('rechaza un metodo fuera del catalogo cerrado', async () => {
    const body = { subject: SUJETO, jti: JTI, method: 'PUSH' }

    const response = await request(app.getHttpServer()).post(RUTA).set(firmar(body)).send(body)

    expect(response.status).toBe(400)
  })

  it('rechaza una firma valida para otro metodo', async () => {
    const firmado = { subject: SUJETO, jti: JTI, method: METODO }
    const enviado = { subject: SUJETO, jti: JTI, method: SecondFactorMethod.Email }

    const response = await request(app.getHttpServer())
      .post(RUTA)
      .set(firmar(firmado))
      .send(enviado)

    expect(response.status).toBe(401)
  })
})
