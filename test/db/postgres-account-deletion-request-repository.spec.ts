import 'reflect-metadata'

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { Kysely } from 'kysely'

import { describeError } from '../../src/infrastructure/observability/describe-error'
import { createDatabase, migrateToLatest } from '../../src/infrastructure/persistence/database'
import { PostgresAccountRepository } from '../../src/adapters/outbound/persistence/PostgresAccountRepository'
import { PostgresAccountDeletionRequestRepository } from '../../src/adapters/outbound/persistence/PostgresAccountDeletionRequestRepository'
import type { Database } from '../../src/adapters/outbound/persistence/schema'
import { AccountId } from '../../src/domain/value-objects/AccountId'
import { AccountDeletionRequest } from '../../src/domain/entities/AccountDeletionRequest'
import { AccountHasActiveDeletionRequestError } from '../../src/application/errors/ApplicationError'
import { buildAccount } from '../support/account-factory'

/**
 * Adaptador de PostgreSQL contra un motor REAL, en contenedor.
 *
 * HU-43.1 exige que la proteccion contra dos solicitudes activas sea real
 * frente a concurrencia, no solo `if (!exists) insert` a nivel de aplicacion.
 * Esta suite es la unica capaz de comprobar eso: un doble en memoria no
 * ejecuta dos peticiones en paralelo contra el mismo motor.
 */
describe('PostgresAccountDeletionRequestRepository', () => {
  let container: StartedPostgreSqlContainer
  let db: Kysely<Database>
  let repository: PostgresAccountDeletionRequestRepository

  const AT = new Date('2026-09-03T12:00:00.000Z')
  const LATER = new Date('2026-09-10T09:00:00.000Z')
  let contador = 0

  const nextId = (): string => {
    contador += 1

    return `del-${String(contador)}`
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start()
    db = createDatabase({ connectionString: container.getConnectionUri() })

    const { error } = await migrateToLatest(db)

    if (error !== undefined) {
      throw new Error(`Las migraciones fallaron: ${describeError(error)}`)
    }

    const accounts = new PostgresAccountRepository(db)
    for (const id of ['acc-1', 'acc-2', 'acc-3', 'acc-4', 'acc-5', 'acc-6']) {
      await accounts.save(
        buildAccount({ id, email: `${id}@nexus.test`, displayName: `Jugador ${id}` }),
      )
    }
  }, 120_000)

  afterAll(async () => {
    await db.destroy()
    await container.stop()
  })

  beforeEach(() => {
    repository = new PostgresAccountDeletionRequestRepository(db)
  })

  it('guarda y recupera una solicitud por su identificador', async () => {
    const id = nextId()
    const request = AccountDeletionRequest.receive({
      id,
      accountId: AccountId.create('acc-1'),
      occurredAt: AT,
    })

    await repository.save(request)
    const found = await repository.findById(id)

    expect(found?.toSnapshot()).toEqual(request.toSnapshot())
  })

  it('devuelve null cuando el identificador no existe', async () => {
    expect(await repository.findById('inexistente')).toBeNull()
  })

  it('encuentra la solicitud activa de una cuenta', async () => {
    const id = nextId()
    await repository.save(
      AccountDeletionRequest.receive({ id, accountId: AccountId.create('acc-2'), occurredAt: AT }),
    )

    const found = await repository.findActiveByAccountId(AccountId.create('acc-2'))

    expect(found?.id).toBe(id)
  })

  it('persiste el avance de estado hasta el cierre, con closed_at', async () => {
    const id = nextId()
    const accountId = AccountId.create('acc-3')
    const request = AccountDeletionRequest.receive({ id, accountId, occurredAt: AT })
    await repository.save(request)

    request.beginTreatment()
    await repository.save(request)

    request.close(LATER)
    await repository.save(request)

    const found = await repository.findById(id)

    expect(found?.currentStatus).toBe('CLOSED')
    expect(found?.currentClosedAt).toEqual(LATER)
    // Cerrada: ya no cuenta como la solicitud activa de la cuenta.
    expect(await repository.findActiveByAccountId(accountId)).toBeNull()
  })

  it('sobrevive a la reconstruccion del repositorio (durabilidad, no memoria de proceso)', async () => {
    const id = nextId()
    const accountId = AccountId.create('acc-4')
    const request = AccountDeletionRequest.receive({ id, accountId, occurredAt: AT })
    request.beginTreatment()
    await repository.save(request)

    // Simula que el componente de aplicacion se destruye y se recrea: una
    // instancia NUEVA del repositorio, sobre la misma base, sin ningun estado
    // compartido en memoria con la que guardo la solicitud.
    const reconstructedRepository = new PostgresAccountDeletionRequestRepository(db)
    const recovered = await reconstructedRepository.findActiveByAccountId(accountId)

    expect(recovered?.id).toBe(id)
    expect(recovered?.currentStatus).toBe('IN_PROGRESS')
  })

  it('rechaza una segunda solicitud activa para la misma cuenta', async () => {
    const accountId = AccountId.create('acc-5')
    await repository.save(
      AccountDeletionRequest.receive({ id: nextId(), accountId, occurredAt: AT }),
    )

    await expect(
      repository.save(AccountDeletionRequest.receive({ id: nextId(), accountId, occurredAt: AT })),
    ).rejects.toThrow(AccountHasActiveDeletionRequestError)
  })

  it('impide la carrera: de dos solicitudes concurrentes para la misma cuenta, solo una se persiste', async () => {
    const accountId = AccountId.create('acc-6')
    const primera = AccountDeletionRequest.receive({ id: nextId(), accountId, occurredAt: AT })
    const segunda = AccountDeletionRequest.receive({ id: nextId(), accountId, occurredAt: AT })

    // Sin `await` entre ambas: las dos llegan a PostgreSQL como peticiones en
    // vuelo al mismo tiempo. Si la proteccion fuera solo un `if (!exists)`
    // previo en la aplicacion, ambas podrian leer "no existe" antes de que
    // cualquiera escriba, y las dos se insertarian. El indice unico parcial
    // de la migracion es lo que reduce esto a exactamente una ganadora.
    const resultados = await Promise.allSettled([
      repository.save(primera),
      repository.save(segunda),
    ])

    const cumplidas = resultados.filter((r) => r.status === 'fulfilled')
    const rechazadas = resultados.filter((r) => r.status === 'rejected')

    expect(cumplidas).toHaveLength(1)
    expect(rechazadas).toHaveLength(1)
    expect(rechazadas[0]!.reason).toBeInstanceOf(AccountHasActiveDeletionRequestError)

    const activa = await repository.findActiveByAccountId(accountId)
    expect(activa).not.toBeNull()
  })
})
