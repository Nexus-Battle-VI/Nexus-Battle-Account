import { AccountId } from '../../src/domain/value-objects/AccountId'
import { AccountDeletionRequest } from '../../src/domain/entities/AccountDeletionRequest'
import { InMemoryAccountDeletionRequestRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountDeletionRequestRepository'
import { AccountDeletionProcessingScheduler } from '../../src/infrastructure/scheduling/AccountDeletionProcessingScheduler'
import type { ProcessAccountDeletion } from '../../src/application/use-cases/ProcessAccountDeletion'
import { createLogger } from '../../src/infrastructure/observability/logger'

const AT = new Date('2026-09-03T12:00:00.000Z')

const silentLogger = createLogger({
  level: 'error',
  service: 'test',
  version: '0.0.0',
  sink: () => undefined,
})

describe('AccountDeletionProcessingScheduler (HU-43.3)', () => {
  it('apagado por defecto: onModuleInit no arranca ningun temporizador', () => {
    const deletionRequests = new InMemoryAccountDeletionRequestRepository()
    const executeMock = jest.fn()
    const processAccountDeletion = { execute: executeMock } as unknown as ProcessAccountDeletion
    const scheduler = new AccountDeletionProcessingScheduler({
      enabled: false,
      intervalMs: 1_000,
      deletionRequests,
      processAccountDeletion,
      logger: silentLogger,
    })

    scheduler.onModuleInit()
    scheduler.onModuleDestroy()

    expect(executeMock).not.toHaveBeenCalled()
  })

  it('tick procesa cada solicitud reclamada, en orden, hasta que no queda ninguna pendiente', async () => {
    const deletionRequests = new InMemoryAccountDeletionRequestRepository()
    for (const id of ['del-1', 'del-2', 'del-3']) {
      const request = AccountDeletionRequest.receive({
        id,
        accountId: AccountId.create(`acc-${id}`),
        occurredAt: AT,
      })
      await deletionRequests.save(request)
    }

    const executed: string[] = []
    const processAccountDeletion = {
      execute: jest.fn((request: AccountDeletionRequest) => {
        executed.push(request.id)
        // El caso de uso real cierra la solicitud al terminar: sin esto,
        // `claimNextPending` volveria a reclamar la MISMA (sigue `IN_PROGRESS`,
        // sigue siendo la mas antigua) en la siguiente vuelta del lote.
        request.close(AT)

        return deletionRequests
          .save(request)
          .then(() => ({ outcome: 'CLOSED' as const, requestId: request.id }))
      }),
    } as unknown as ProcessAccountDeletion

    const scheduler = new AccountDeletionProcessingScheduler({
      enabled: true,
      intervalMs: 1_000,
      deletionRequests,
      processAccountDeletion,
      logger: silentLogger,
    })

    const processed = await scheduler.tick()

    expect(processed).toBe(3)
    expect(executed).toEqual(['del-1', 'del-2', 'del-3'])
  })

  it('un fallo al procesar una solicitud no hace que tick() rechace: se detiene en el tope de seguridad', async () => {
    const deletionRequests = new InMemoryAccountDeletionRequestRepository()
    const request = AccountDeletionRequest.receive({
      id: 'del-1',
      accountId: AccountId.create('acc-1'),
      occurredAt: AT,
    })
    await deletionRequests.save(request)

    // `execute` rechaza SIEMPRE: sin cerrar la solicitud, `claimNextPending`
    // vuelve a devolver la MISMA en cada vuelta -sigue siendo la mas antigua
    // no cerrada-. Es una limitacion conocida de una cola FIFO simple sin
    // cola de mensajes fallidos propia: una solicitud que falla en todos los
    // intentos ocupa la cabecera y el tope por pasada (`MAX_CLAIMS_PER_TICK`)
    // es lo unico que evita que consuma el bucle de eventos sin limite.
    const executeMock = jest.fn(() => Promise.reject(new Error('fallo de persistencia del cierre')))
    const processAccountDeletion = { execute: executeMock } as unknown as ProcessAccountDeletion

    const scheduler = new AccountDeletionProcessingScheduler({
      enabled: true,
      intervalMs: 1_000,
      deletionRequests,
      processAccountDeletion,
      logger: silentLogger,
    })

    await expect(scheduler.tick()).resolves.toBe(20)
    expect(executeMock).toHaveBeenCalledTimes(20)
  })

  it('devuelve 0 cuando no hay ninguna solicitud pendiente', async () => {
    const deletionRequests = new InMemoryAccountDeletionRequestRepository()
    const executeMock = jest.fn()
    const processAccountDeletion = { execute: executeMock } as unknown as ProcessAccountDeletion

    const scheduler = new AccountDeletionProcessingScheduler({
      enabled: true,
      intervalMs: 1_000,
      deletionRequests,
      processAccountDeletion,
      logger: silentLogger,
    })

    expect(await scheduler.tick()).toBe(0)
    expect(executeMock).not.toHaveBeenCalled()
  })

  it('activado: onModuleInit arranca un temporizador y onModuleDestroy lo detiene', () => {
    jest.useFakeTimers()
    const setIntervalSpy = jest.spyOn(global, 'setInterval')
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval')

    const deletionRequests = new InMemoryAccountDeletionRequestRepository()
    const processAccountDeletion = { execute: jest.fn() } as unknown as ProcessAccountDeletion
    const scheduler = new AccountDeletionProcessingScheduler({
      enabled: true,
      intervalMs: 5_000,
      deletionRequests,
      processAccountDeletion,
      logger: silentLogger,
    })

    scheduler.onModuleInit()

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5_000)

    scheduler.onModuleDestroy()

    expect(clearIntervalSpy).toHaveBeenCalled()

    setIntervalSpy.mockRestore()
    clearIntervalSpy.mockRestore()
    jest.useRealTimers()
  })
})
