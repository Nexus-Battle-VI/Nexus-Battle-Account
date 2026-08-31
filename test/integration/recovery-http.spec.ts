import { ValidationPipe } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../../src/infrastructure/bootstrap/app.module'
import { FixedRecoveryOtp } from '../../src/adapters/outbound/identity/FixedRecoveryOtp'
import { FOUR_ANSWERS, VALID_PASSWORD } from '../support/account-factory'
import { registerAccountRequest } from '../support/http-register'

describe('HU-04 recovery HTTP', () => {
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

  it('completa el flujo de cuatro pasos sobre una cuenta recien registrada', async () => {
    await registerAccountRequest(app, {
      email: 'recupera@nexus.test',
      nickname: 'Recupera',
    }).expect(201)

    const started = await request(app.getHttpServer())
      .post('/api/accounts/recovery')
      .send({ email: 'recupera@nexus.test' })
      .expect(200)

    expect(started.body.challengeToken).toEqual(expect.any(String))
    expect(started.body.questions).toHaveLength(4)

    await request(app.getHttpServer())
      .post('/api/accounts/recovery/answers')
      .send({ challengeToken: started.body.challengeToken, answers: FOUR_ANSWERS })
      .expect(200)

    await request(app.getHttpServer())
      .post('/api/accounts/recovery/code')
      .send({ challengeToken: started.body.challengeToken, code: '111111' })
      .expect(400)

    await request(app.getHttpServer())
      .post('/api/accounts/recovery/code')
      .send({ challengeToken: started.body.challengeToken, code: FixedRecoveryOtp.CODE })
      .expect(200)

    await request(app.getHttpServer())
      .post('/api/accounts/recovery/password')
      .send({ challengeToken: started.body.challengeToken, password: 'corta' })
      .expect(400)

    await request(app.getHttpServer())
      .post('/api/accounts/recovery/password')
      .send({ challengeToken: started.body.challengeToken, password: 'NuevaClave9!' })
      .expect(200)

    await request(app.getHttpServer())
      .post('/api/accounts/recovery/code')
      .send({ challengeToken: started.body.challengeToken, code: FixedRecoveryOtp.CODE })
      .expect(400)
  })

  it('un correo inexistente no se distingue en el paso 1 y falla al responder', async () => {
    const started = await request(app.getHttpServer())
      .post('/api/accounts/recovery')
      .send({ email: 'no-existe@nexus.test' })
      .expect(200)

    expect(started.body.questions).toHaveLength(4)

    await request(app.getHttpServer())
      .post('/api/accounts/recovery/answers')
      .send({ challengeToken: started.body.challengeToken, answers: FOUR_ANSWERS })
      .expect(400)
  })

  it('no permite saltar al cambio de contrasena', async () => {
    await request(app.getHttpServer())
      .post('/api/accounts/recovery/password')
      .send({ challengeToken: 'inventado', password: VALID_PASSWORD })
      .expect(400)
  })
})
