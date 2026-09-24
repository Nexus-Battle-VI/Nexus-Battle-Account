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
import {
  ACCOUNT_REPOSITORY,
  type AccountRepositoryPort,
} from '../../src/application/ports/AccountRepositoryPort'
import {
  SANCTION_REPOSITORY,
  type SanctionRepositoryPort,
} from '../../src/application/ports/SanctionRepositoryPort'
import { Account } from '../../src/domain/entities/Account'
import { AccountStatus } from '../../src/domain/entities/AccountStatus'
import { Role } from '../../src/domain/entities/Role'
import { Sanction } from '../../src/domain/entities/Sanction'
import { SanctionType } from '../../src/domain/entities/SanctionType'
import { AccountId } from '../../src/domain/value-objects/AccountId'
import { DisplayName } from '../../src/domain/value-objects/DisplayName'
import { EmailAddress } from '../../src/domain/value-objects/EmailAddress'
import { PersonName } from '../../src/domain/value-objects/PersonName'
import { defaultAvatarMetadata } from '../support/account-factory'

/** Secreto FICTICIO, exclusivo de estas pruebas. No existe en ningun entorno. */
const SECRETO = 'secreto-de-pruebas-no-usado-en-ningun-entorno'
const rutaSanciones = (subject: string): string =>
  `/api/internal/accounts/${subject}/active-sanctions`

const firmar = (
  path: string,
  overrides: { service?: string; timestamp?: string; signature?: string } = {},
): Record<string, string> => {
  const service = overrides.service ?? 'auction'
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

const buildAccount = (id: string, subject: string, status: AccountStatus): Account =>
  Account.restore({
    id: AccountId.create(id),
    subject,
    email: EmailAddress.create(`${id}@nexus.test`),
    displayName: DisplayName.create(`Vendedor ${id}`),
    firstNames: PersonName.create('Vendedor', 'De Pruebas'),
    lastNames: PersonName.create('Apellido', 'De Pruebas'),
    termsAccepted: true,
    avatar: defaultAvatarMetadata(id),
    status,
    roles: [Role.Player],
  })

describe('Contrato interno de estado de sanciones (HU-62)', () => {
  let app: INestApplication
  let accounts: AccountRepositoryPort
  let sanctions: SanctionRepositoryPort
  let previousEnv: Record<string, string | undefined>

  beforeAll(async () => {
    previousEnv = { ...process.env }
    process.env.PERSISTENCE_DRIVER = 'memory'
    process.env.AUTH_MODE = 'disabled'
    process.env.AUTHENTICATION_DRIVER = 'fake'
    process.env.INTERNAL_SERVICE_AUTH_SECRET = SECRETO
    process.env.INTERNAL_SERVICE_ALLOWED_SERVICES = 'auction'

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('api')
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )
    await app.init()

    accounts = app.get<AccountRepositoryPort>(ACCOUNT_REPOSITORY)
    sanctions = app.get<SanctionRepositoryPort>(SANCTION_REPOSITORY)
  })

  afterAll(async () => {
    await app.close()
    process.env = previousEnv
  })

  it('responde false para una cuenta activa sin sanciones', async () => {
    await accounts.save(
      buildAccount('vendedor-activo', 'sub:vendedor-activo', AccountStatus.Active),
    )
    const ruta = rutaSanciones('sub:vendedor-activo')

    const response = await request(app.getHttpServer()).get(ruta).set(firmar(ruta))

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ hasActiveSanctions: false })
  })

  it('responde true para una cuenta con veto permanente', async () => {
    await accounts.save(
      buildAccount('vendedor-vetado', 'sub:vendedor-vetado', AccountStatus.Banned),
    )
    const ruta = rutaSanciones('sub:vendedor-vetado')

    const response = await request(app.getHttpServer()).get(ruta).set(firmar(ruta))

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ hasActiveSanctions: true })
  })

  it('responde true para una cuenta con suspension temporal vigente', async () => {
    const id = 'vendedor-suspendido'
    await accounts.save(buildAccount(id, `sub:${id}`, AccountStatus.Suspended))
    await sanctions.save(
      Sanction.create({
        id: `sancion-${id}`,
        targetAccountId: id,
        actorAccountId: 'moderador-pruebas',
        type: SanctionType.TemporarySuspension,
        reason: 'Comportamiento reportado',
        createdAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() + 60 * 60_000),
      }),
    )
    const ruta = rutaSanciones(`sub:${id}`)

    const response = await request(app.getHttpServer()).get(ruta).set(firmar(ruta))

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ hasActiveSanctions: true })
  })

  /**
   * Consulta pura: la suspension ya vencida no bloquea, y a diferencia de
   * `LoginAccount` esta ruta NO reincorpora la cuenta como efecto secundario
   * de que otro servicio pregunte.
   */
  it('responde false para una suspension temporal ya vencida, sin reincorporar la cuenta', async () => {
    const id = 'vendedor-vencido'
    await accounts.save(buildAccount(id, `sub:${id}`, AccountStatus.Suspended))
    await sanctions.save(
      Sanction.create({
        id: `sancion-${id}`,
        targetAccountId: id,
        actorAccountId: 'moderador-pruebas',
        type: SanctionType.TemporarySuspension,
        reason: 'Comportamiento reportado',
        createdAt: new Date(Date.now() - 120 * 60_000),
        expiresAt: new Date(Date.now() - 60_000),
      }),
    )
    const ruta = rutaSanciones(`sub:${id}`)

    const response = await request(app.getHttpServer()).get(ruta).set(firmar(ruta))

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ hasActiveSanctions: false })

    const stillSuspended = await accounts.findById(AccountId.create(id))
    expect(stillSuspended?.currentStatus).toBe(AccountStatus.Suspended)
  })

  it('responde 404 cuando el sujeto no tiene cuenta en este servicio', async () => {
    const ruta = rutaSanciones('sujeto-sin-cuenta')

    const response = await request(app.getHttpServer()).get(ruta).set(firmar(ruta))

    expect(response.status).toBe(404)
  })

  it('rechaza una llamada sin autenticacion entre servicios', async () => {
    const ruta = rutaSanciones('anonymous')

    const response = await request(app.getHttpServer()).get(ruta)

    expect(response.status).toBe(401)
  })

  it('rechaza un servicio que no esta en la lista permitida', async () => {
    const ruta = rutaSanciones('anonymous')

    const response = await request(app.getHttpServer())
      .get(ruta)
      .set(firmar(ruta, { service: 'servicio-no-listado' }))

    expect(response.status).toBe(401)
  })
})
