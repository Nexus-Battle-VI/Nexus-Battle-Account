import { AccountId } from '../../src/domain/value-objects/AccountId'
import { AccountDeletionRequest } from '../../src/domain/entities/AccountDeletionRequest'
import { InMemoryAccountRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountRepository'
import { InMemoryAccountDeletionRequestRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountDeletionRequestRepository'
import { InMemoryAvatarStorage } from '../../src/adapters/outbound/storage/InMemoryAvatarStorage'
import type { NotificationRequest } from '../../src/application/ports/NotificationRequestPort'
import {
  ProcessAccountDeletion,
  ProcessAccountDeletionOutcome,
  type ProcessAccountDeletionLog,
} from '../../src/application/use-cases/ProcessAccountDeletion'
import { buildAccount, defaultAvatarMetadata } from '../support/account-factory'

const AT = new Date('2026-09-03T12:00:00.000Z')
const CLOCK_NOW = new Date('2026-09-03T12:05:00.000Z')

const silentLog: ProcessAccountDeletionLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

const fixedClock = { now: () => CLOCK_NOW }

const receiveAndClaim = (
  deletionRequests: InMemoryAccountDeletionRequestRepository,
  overrides: { id?: string; accountId?: string } = {},
): Promise<AccountDeletionRequest> => {
  const request = AccountDeletionRequest.receive({
    id: overrides.id ?? 'del-1',
    accountId: AccountId.create(overrides.accountId ?? 'acc-1'),
    occurredAt: AT,
  })
  request.beginTreatment()

  return deletionRequests.save(request).then(() => request)
}

interface Harness {
  readonly accounts: InMemoryAccountRepository
  readonly deletionRequests: InMemoryAccountDeletionRequestRepository
  readonly avatars: InMemoryAvatarStorage
  readonly notifications: { request: (n: NotificationRequest) => Promise<void> }
  readonly notified: NotificationRequest[]
  readonly useCase: ProcessAccountDeletion
}

const buildHarness = (
  options: { notifications?: (n: NotificationRequest) => Promise<void> } = {},
): Harness => {
  const accounts = new InMemoryAccountRepository()
  const deletionRequests = new InMemoryAccountDeletionRequestRepository()
  const avatars = new InMemoryAvatarStorage()
  const notified: NotificationRequest[] = []

  const notifications = {
    request: (n: NotificationRequest): Promise<void> => {
      notified.push(n)

      return options.notifications?.(n) ?? Promise.resolve()
    },
  }

  const useCase = new ProcessAccountDeletion({
    accounts,
    deletionRequests,
    avatars,
    notifications,
    clock: fixedClock,
    logger: silentLog,
  })

  return { accounts, deletionRequests, avatars, notifications, notified, useCase }
}

describe('ProcessAccountDeletion (HU-43.3)', () => {
  it('flujo exitoso: trata los datos aprobados, cierra la solicitud y solicita la notificacion de cierre', async () => {
    const harness = buildHarness()
    const account = buildAccount({ id: 'acc-1', email: 'ana@nexus.test' })
    await harness.accounts.saveRegistration(account, [
      { questionId: 'sq-01', answerHash: 'hash-1' },
    ])
    await harness.avatars.store({
      accountId: 'acc-1',
      mimeType: 'image/png',
      originalName: 'a.png',
      bytes: Buffer.from('avatar'),
    })
    const request = await receiveAndClaim(harness.deletionRequests)

    const result = await harness.useCase.execute(request)

    expect(result).toEqual({ outcome: ProcessAccountDeletionOutcome.Closed, requestId: 'del-1' })

    const closed = await harness.deletionRequests.findById('del-1')
    expect(closed?.currentStatus).toBe('CLOSED')
    expect(closed?.currentClosedAt).toEqual(CLOCK_NOW)
  })

  it('elimina fisicamente la cuenta y sus respuestas de seguridad (categoria aprobada: eliminar)', async () => {
    const harness = buildHarness()
    const account = buildAccount({ id: 'acc-1' })
    await harness.accounts.saveRegistration(account, [
      { questionId: 'sq-01', answerHash: 'hash-1' },
    ])
    const request = await receiveAndClaim(harness.deletionRequests)

    await harness.useCase.execute(request)

    expect(await harness.accounts.findById(AccountId.create('acc-1'))).toBeNull()
    expect(await harness.accounts.findSecurityAnswers(AccountId.create('acc-1'))).toEqual([])
  })

  it('elimina el avatar mediante el adaptador de almacenamiento existente (no borrado ad-hoc)', async () => {
    const harness = buildHarness()
    const account = buildAccount({ id: 'acc-1' })
    await harness.accounts.save(account)
    const storageKey = defaultAvatarMetadata('acc-1').storageKey
    await harness.avatars.store({
      accountId: 'acc-1',
      mimeType: 'image/png',
      originalName: 'a.png',
      bytes: Buffer.from('avatar'),
    })
    const request = await receiveAndClaim(harness.deletionRequests)

    await harness.useCase.execute(request)

    expect(harness.avatars.has(storageKey)).toBe(false)
  })

  it('retry cuando el avatar ya no existe: no falla (el storage es idempotente)', async () => {
    const harness = buildHarness()
    const account = buildAccount({ id: 'acc-1' })
    await harness.accounts.save(account)
    // El avatar NUNCA se almaceno en este doble: `remove` sobre una clave
    // ausente debe ser un no-op, no un error, igual que `LocalAvatarStorage`
    // con `rm(..., { force: true })`.
    const request = await receiveAndClaim(harness.deletionRequests)

    const result = await harness.useCase.execute(request)

    expect(result.outcome).toBe(ProcessAccountDeletionOutcome.Closed)
  })

  it('idempotencia: procesar una solicitud ya CLOSED no repite tratamiento ni notifica de nuevo', async () => {
    const harness = buildHarness()
    const request = AccountDeletionRequest.receive({
      id: 'del-cerrada',
      accountId: AccountId.create('acc-1'),
      occurredAt: AT,
    })
    request.beginTreatment()
    request.close(AT)
    await harness.deletionRequests.save(request)

    const result = await harness.useCase.execute(request)

    expect(result).toEqual({
      outcome: ProcessAccountDeletionOutcome.AlreadyClosed,
      requestId: 'del-cerrada',
    })
    expect(harness.notified).toHaveLength(0)
  })

  it('idempotencia: reanudar una solicitud cuya cuenta ya fue eliminada en un intento anterior no falla', async () => {
    const harness = buildHarness()
    // Sin cuenta guardada: simula que un intento previo ya la elimino y se
    // interrumpio antes de cerrar la solicitud.
    const request = await receiveAndClaim(harness.deletionRequests)

    const result = await harness.useCase.execute(request)

    expect(result.outcome).toBe(ProcessAccountDeletionOutcome.Closed)
    // Sin cuenta que consultar, no hay destinatario que capturar: la
    // notificacion de cierre se pierde en este escenario, documentado en el
    // PR como limitacion conocida del fire-and-forget de Notifications.
    expect(harness.notified).toHaveLength(0)
  })

  it('fallo intermedio: deja la solicitud FAILED, sin cerrar, y permite reintentar hasta terminar', async () => {
    const accounts = new InMemoryAccountRepository()
    const deletionRequests = new InMemoryAccountDeletionRequestRepository()
    await accounts.save(buildAccount({ id: 'acc-1' }))
    const request = await receiveAndClaim(deletionRequests)

    let intentos = 0
    const avataresInestables = {
      store: () => Promise.reject(new Error('no debe llamarse')),
      remove: (): Promise<void> => {
        intentos += 1

        if (intentos === 1) {
          return Promise.reject(new Error('almacenamiento no disponible'))
        }

        return Promise.resolve()
      },
    }

    const useCase = new ProcessAccountDeletion({
      accounts,
      deletionRequests,
      avatars: avataresInestables,
      notifications: { request: () => Promise.resolve() },
      clock: fixedClock,
      logger: silentLog,
    })

    const primerIntento = await useCase.execute(request)
    expect(primerIntento.outcome).toBe(ProcessAccountDeletionOutcome.Failed)
    expect((await deletionRequests.findById('del-1'))?.currentStatus).toBe('FAILED')

    // Reanuda: `claimNextPending` reclama la FAILED y la reintenta.
    const reclamada = await deletionRequests.claimNextPending()
    const segundoIntento = await useCase.execute(reclamada!)

    expect(segundoIntento.outcome).toBe(ProcessAccountDeletionOutcome.Closed)
    expect(await accounts.findById(AccountId.create('acc-1'))).toBeNull()
  })

  it('la notificacion se solicita UNICAMENTE despues de que el cierre ya quedo persistido', async () => {
    const order: string[] = []
    const accounts = new InMemoryAccountRepository()
    const deletionRequests = new InMemoryAccountDeletionRequestRepository()
    await accounts.save(buildAccount({ id: 'acc-1' }))
    const request = await receiveAndClaim(deletionRequests)

    const originalSave = deletionRequests.save.bind(deletionRequests)
    deletionRequests.save = (r) => {
      order.push('save')

      return originalSave(r)
    }

    const useCase = new ProcessAccountDeletion({
      accounts,
      deletionRequests,
      avatars: new InMemoryAvatarStorage(),
      notifications: {
        request: (): Promise<void> => {
          order.push('notify')

          return Promise.resolve()
        },
      },
      clock: fixedClock,
      logger: silentLog,
    })

    await useCase.execute(request)

    expect(order).toEqual(['save', 'notify'])
    const closed = await deletionRequests.findById('del-1')
    expect(closed?.currentStatus).toBe('CLOSED')
  })

  it('usa el templateId real de HU-43.4 (#306), sin variables, con el correo real como destinatario', async () => {
    const harness = buildHarness()
    await harness.accounts.save(buildAccount({ id: 'acc-1', email: 'ana@nexus.test' }))
    const request = await receiveAndClaim(harness.deletionRequests)

    await harness.useCase.execute(request)

    expect(harness.notified).toEqual([
      {
        notificationId: 'del-1',
        recipient: 'ana@nexus.test',
        templateId: 'account-deletion-closed',
        variables: {},
      },
    ])
  })

  it('un fallo de Notifications no deshace el tratamiento ya completado (sigue CLOSED)', async () => {
    const harness = buildHarness({
      notifications: () => Promise.reject(new Error('proveedor de correo caido')),
    })
    await harness.accounts.save(buildAccount({ id: 'acc-1' }))
    const request = await receiveAndClaim(harness.deletionRequests)

    const result = await harness.useCase.execute(request)

    expect(result.outcome).toBe(ProcessAccountDeletionOutcome.Closed)
    expect((await harness.deletionRequests.findById('del-1'))?.currentStatus).toBe('CLOSED')
  })

  it('ownership: sus dependencias declaradas no incluyen ningun puerto de Community, Commerce, Inventory ni Catalog', () => {
    const harness = buildHarness()

    // Prueba de diseno, no de comportamiento: enumera EXACTAMENTE las
    // dependencias reales del caso de uso. Anadir una llamada de eliminacion
    // a otro bounded context exigiria anadir aqui una dependencia nueva -y
    // esta prueba deja eso imposible de colar sin que falle.
    const deps = (harness.useCase as unknown as { deps: Record<string, unknown> }).deps

    expect(Object.keys(deps).sort()).toEqual([
      'accounts',
      'avatars',
      'clock',
      'deletionRequests',
      'logger',
      'notifications',
    ])
  })

  it('verifica el plazo de 30 dias sin bloquear ni alterar el tratamiento de una solicitud fuera de plazo', async () => {
    const accounts = new InMemoryAccountRepository()
    const deletionRequests = new InMemoryAccountDeletionRequestRepository()
    await accounts.save(buildAccount({ id: 'acc-1' }))
    const request = AccountDeletionRequest.receive({
      id: 'del-vencida',
      accountId: AccountId.create('acc-1'),
      // Recibida hace mas de 30 dias respecto al reloj fijo de la prueba.
      occurredAt: new Date('2026-06-01T00:00:00.000Z'),
    })
    request.beginTreatment()
    await deletionRequests.save(request)

    const advertencias: string[] = []
    const useCase = new ProcessAccountDeletion({
      accounts,
      deletionRequests,
      avatars: new InMemoryAvatarStorage(),
      notifications: { request: () => Promise.resolve() },
      clock: fixedClock,
      logger: {
        info: () => undefined,
        warn: (message) => {
          advertencias.push(message)
        },
        error: () => undefined,
      },
    })

    const result = await useCase.execute(request)

    expect(advertencias).toContain('account_deletion_overdue')
    // Fuera de plazo se REGISTRA, pero no impide ni desvia el cierre: HU-43 no
    // define ninguna accion de negocio adicional para este caso.
    expect(result.outcome).toBe(ProcessAccountDeletionOutcome.Closed)
  })
})
