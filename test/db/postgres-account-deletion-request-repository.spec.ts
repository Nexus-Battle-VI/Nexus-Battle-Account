import 'reflect-metadata'

import { startTestPostgres, type TestPostgres } from './postgres-runtime'
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
  let container: TestPostgres
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
    container = await startTestPostgres()
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

  /**
   * `claimNextPending` no filtra por cuenta: reclama la mas antigua NO
   * cerrada de TODA la tabla. Las pruebas anteriores de este fichero dejan
   * -a proposito, para probar otra cosa- cuentas con solicitudes activas sin
   * cerrar (p. ej. la primerisima, sobre `acc-1`). Por eso este describe
   * empieza vaciando la tabla de pendientes, y cada prueba cierra lo que deja
   * activo: sin eso, el orden FIFO entre pruebas seria arbitrario.
   */
  describe('claimNextPending (HU-43.3)', () => {
    const drainPending = async (): Promise<void> => {
      for (;;) {
        const claimed = await repository.claimNextPending()

        if (claimed === null) {
          return
        }

        claimed.close(LATER)
        await repository.save(claimed)
      }
    }

    beforeAll(async () => {
      await drainPending()
    })

    afterEach(async () => {
      await drainPending()
    })

    it('devuelve null cuando no hay ninguna solicitud pendiente', async () => {
      expect(await repository.claimNextPending()).toBeNull()
    })

    it('reclama una RECEIVED y la deja IN_PROGRESS de forma durable', async () => {
      const id = nextId()
      await repository.save(
        AccountDeletionRequest.receive({
          id,
          accountId: AccountId.create('acc-claim-received'),
          occurredAt: AT,
        }),
      )

      const claimed = await repository.claimNextPending()

      expect(claimed?.id).toBe(id)
      expect(claimed?.currentStatus).toBe('IN_PROGRESS')

      const reconstructedRepository = new PostgresAccountDeletionRequestRepository(db)
      expect((await reconstructedRepository.findById(id))?.currentStatus).toBe('IN_PROGRESS')
    })

    it('reclama primero la solicitud pendiente mas antigua (orden FIFO por received_at)', async () => {
      const idAntigua = nextId()
      const idReciente = nextId()

      await repository.save(
        AccountDeletionRequest.receive({
          id: idReciente,
          accountId: AccountId.create('acc-claim-reciente'),
          occurredAt: LATER,
        }),
      )
      await repository.save(
        AccountDeletionRequest.receive({
          id: idAntigua,
          accountId: AccountId.create('acc-claim-antigua'),
          occurredAt: AT,
        }),
      )

      expect((await repository.claimNextPending())?.id).toBe(idAntigua)
    })

    it('impide que dos procesadores reclamen la MISMA solicitud a la vez (FOR UPDATE SKIP LOCKED)', async () => {
      const id = nextId()
      await repository.save(
        AccountDeletionRequest.receive({
          id,
          accountId: AccountId.create('acc-claim-concurrencia'),
          occurredAt: AT,
        }),
      )

      const otroProcesador = new PostgresAccountDeletionRequestRepository(db)

      // Sin `await` entre ambas: las dos transacciones llegan a PostgreSQL en
      // vuelo al mismo tiempo. Si la proteccion fuera solo "leer y luego
      // actualizar" a nivel de aplicacion, las dos podrian leer la misma fila
      // como RECEIVED antes de que cualquiera la marque IN_PROGRESS. Con
      // `FOR UPDATE SKIP LOCKED`, la segunda transaccion salta la fila
      // bloqueada por la primera y, al no haber ninguna otra pendiente,
      // recibe `null`.
      const [primero, segundo] = await Promise.all([
        repository.claimNextPending(),
        otroProcesador.claimNextPending(),
      ])

      const ganadores = [primero, segundo].filter(
        (resultado): resultado is AccountDeletionRequest => resultado !== null,
      )

      expect(ganadores).toHaveLength(1)
      expect(ganadores[0]!.id).toBe(id)
    })

    it('reclama de nuevo una IN_PROGRESS sin lanzar (reanuda tras una interrupcion)', async () => {
      const id = nextId()
      const request = AccountDeletionRequest.receive({
        id,
        accountId: AccountId.create('acc-claim-en-curso'),
        occurredAt: AT,
      })
      request.beginTreatment()
      await repository.save(request)

      const claimed = await repository.claimNextPending()

      expect(claimed?.id).toBe(id)
      expect(claimed?.currentStatus).toBe('IN_PROGRESS')
    })

    it('reclama una FAILED y la reintenta (queda IN_PROGRESS)', async () => {
      const id = nextId()
      const request = AccountDeletionRequest.receive({
        id,
        accountId: AccountId.create('acc-claim-fallida'),
        occurredAt: AT,
      })
      request.beginTreatment()
      request.markFailed()
      await repository.save(request)

      const claimed = await repository.claimNextPending()

      expect(claimed?.currentStatus).toBe('IN_PROGRESS')
    })

    it('nunca reclama una solicitud ya CLOSED', async () => {
      const request = AccountDeletionRequest.receive({
        id: nextId(),
        accountId: AccountId.create('acc-claim-cerrada'),
        occurredAt: AT,
      })
      request.beginTreatment()
      request.close(LATER)
      await repository.save(request)

      expect(await repository.claimNextPending()).toBeNull()
    })
  })
})
