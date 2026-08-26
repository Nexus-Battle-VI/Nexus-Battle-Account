import 'reflect-metadata'

import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../../src/infrastructure/bootstrap/app.module'
import { AccountStatus } from '../../src/domain/entities/AccountStatus'
import { Role } from '../../src/domain/entities/Role'
import { registerAccountRequest } from '../support/http-register'

describe('API de cuentas', () => {
  let app: INestApplication

  beforeAll(async () => {
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
  })

  it('POST /api/accounts registra una cuenta y responde 201', async () => {
    const response = await registerAccountRequest(app, {
      email: 'jugador1@nexus.test',
      nickname: 'Ana Uno',
    })

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      email: 'jugador1@nexus.test',
      displayName: 'Ana Uno',
      firstNames: 'Ana',
      lastNames: 'Ramirez',
      status: AccountStatus.PendingVerification,
      roles: [Role.Player],
    })
    expect(typeof response.body.id).toBe('string')
  })

  it('POST /api/accounts responde 409 si el correo ya existe', async () => {
    await registerAccountRequest(app, {
      email: 'duplicado@nexus.test',
      nickname: 'Primero Usuario',
    })

    const response = await registerAccountRequest(app, {
      email: 'duplicado@nexus.test',
      nickname: 'Segundo Usuario',
    })

    expect(response.status).toBe(409)
  })

  it('POST /api/accounts responde 400 ante un correo con formato invalido', async () => {
    const response = await registerAccountRequest(app, {
      email: 'no-es-correo',
      nickname: 'Ana Ramirez',
    })

    expect(response.status).toBe(400)
  })

  it('POST /api/accounts responde 400 si falta el avatar', async () => {
    const response = await registerAccountRequest(
      app,
      { email: 'sin-avatar@nexus.test', nickname: 'Ana Sin Avatar' },
      false,
    )

    expect(response.status).toBe(400)
  })

  it('POST /api/accounts responde 400 si no se aceptan los terminos', async () => {
    const response = await registerAccountRequest(app, {
      email: 'sin-terminos@nexus.test',
      nickname: 'Ana Sin Terminos',
      termsAccepted: 'false',
    })

    expect(response.status).toBe(400)
  })

  it('POST /api/accounts responde 400 ante un apodo demasiado corto', async () => {
    const response = await registerAccountRequest(app, {
      email: 'corto@nexus.test',
      nickname: 'Ab',
    })

    expect(response.status).toBe(400)
  })

  it('POST /api/accounts rechaza campos no declarados en el contrato', async () => {
    const response = await registerAccountRequest(app, {
      email: 'extra@nexus.test',
      nickname: 'Ana Extra',
      roles: 'ADMINISTRATOR',
    })

    expect(response.status).toBe(400)
  })

  it('GET /api/accounts/:id recupera la cuenta registrada', async () => {
    const created = await registerAccountRequest(app, {
      email: 'lectura@nexus.test',
      nickname: 'Ana Lectura',
    })

    const response = await request(app.getHttpServer()).get(
      `/api/accounts/${String(created.body.id)}`,
    )

    expect(response.status).toBe(200)
    expect(response.body).toEqual(created.body)
  })

  it('GET /api/accounts/:id responde 404 si la cuenta no existe', async () => {
    const response = await request(app.getHttpServer()).get('/api/accounts/no-existe')

    expect(response.status).toBe(404)
  })

  it('POST /api/accounts/:id/verification activa la cuenta', async () => {
    const created = await registerAccountRequest(app, {
      email: 'verifica@nexus.test',
      nickname: 'Ana Verifica',
    })
    const id = String(created.body.id)

    const response = await request(app.getHttpServer()).post(`/api/accounts/${id}/verification`)

    expect(response.status).toBe(200)
    expect(response.body.status).toBe(AccountStatus.Active)

    const reread = await request(app.getHttpServer()).get(`/api/accounts/${id}`)
    expect(reread.body.status).toBe(AccountStatus.Active)
  })

  it('POST /api/accounts/:id/verification responde 400 si ya estaba verificada', async () => {
    const created = await registerAccountRequest(app, {
      email: 'doble@nexus.test',
      nickname: 'Ana Doble',
    })
    const id = String(created.body.id)
    await request(app.getHttpServer()).post(`/api/accounts/${id}/verification`)

    const response = await request(app.getHttpServer()).post(`/api/accounts/${id}/verification`)

    expect(response.status).toBe(400)
  })

  it('POST /api/accounts/:id/verification responde 404 si la cuenta no existe', async () => {
    const response = await request(app.getHttpServer()).post('/api/accounts/no-existe/verification')

    expect(response.status).toBe(404)
  })
})

describe('Sondas de salud', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('api')
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it('GET /api/health/live responde 200', async () => {
    const response = await request(app.getHttpServer()).get('/api/health/live')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'ok', checks: {} })
  })

  it('GET /api/health/ready evalua las dependencias reales', async () => {
    const response = await request(app.getHttpServer()).get('/api/health/ready')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'ok', checks: { 'accounts-repository': 'ok' } })
  })

  it('GET /api/version expone servicio, version y entorno', async () => {
    const response = await request(app.getHttpServer()).get('/api/version')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ service: 'nexus-battle-account', version: '0.1.0' })
  })

  it('responde 404 en una ruta desconocida', async () => {
    expect((await request(app.getHttpServer()).get('/api/no-existe')).status).toBe(404)
  })
})
