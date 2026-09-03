import {
  ProcessAccountDeletion,
  ACCOUNT_DELETION_CLOSED_TEMPLATE_ID,
  type ProcessAccountDeletionLog,
} from '../../src/application/use-cases/ProcessAccountDeletion'
import { InMemoryAccountRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountRepository'
import { InMemoryAccountDeletionRequestRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountDeletionRequestRepository'
import { InMemoryAvatarStorage } from '../../src/adapters/outbound/storage/InMemoryAvatarStorage'
import { AccountDeletionRequest } from '../../src/domain/entities/AccountDeletionRequest'
import { AccountId } from '../../src/domain/value-objects/AccountId'
import type { ClockPort } from '../../src/application/ports/ClockPort'
import type {
  NotificationRequest,
  NotificationRequestPort,
} from '../../src/application/ports/NotificationRequestPort'
import { buildActiveAccount } from '../support/account-factory'

const AT = new Date('2026-09-03T12:00:00.000Z')
const LATER = new Date('2026-09-04T00:00:00.000Z')

const fixedClock = (at: Date): ClockPort => ({ now: () => at })

const silentLogger: ProcessAccountDeletionLog = {
  info: (): void => undefined,
  warn: (): void => undefined,
  error: (): void => undefined,
}

class RecordingNotificationRequester implements NotificationRequestPort {
  readonly sent: NotificationRequest[] = []
  private failNext = false

  request(notification: NotificationRequest): Promise<void> {
    if (this.failNext) {
      this.failNext = false

      return Promise.reject(new Error('ingest no disponible'))
    }

    this.sent.push(notification)

    return Promise.resolve()
  }

  failOnce(): void {
    this.failNext = true
  }
}

interface Harness {
  readonly accounts: InMemoryAccountRepository
  readonly requests: InMemoryAccountDeletionRequestRepository
  readonly avatars: InMemoryAvatarStorage
  readonly notifications: RecordingNotificationRequester
  readonly build: (batchLimit?: number) => ProcessAccountDeletion
}

const setup = (): Harness => {
  const accounts = new InMemoryAccountRepository()
  const requests = new InMemoryAccountDeletionRequestRepository()
  const avatars = new InMemoryAvatarStorage()
  const notifications = new RecordingNotificationRequester()

  return {
    accounts,
    requests,
    avatars,
    notifications,
    build: (batchLimit) =>
      new ProcessAccountDeletion({
        accounts,
        requests,
        avatars,
        notifications,
        clock: fixedClock(LATER),
        logger: silentLogger,
        ...(batchLimit === undefined ? {} : { batchLimit }),
      }),
  }
}

const seedAccountWithRequest = async (
  h: Harness,
  overrides: { id?: string; email?: string; requestId?: string } = {},
): Promise<{ accountId: string; requestId: string }> => {
  const accountId = overrides.id ?? 'acc-1'
  const requestId = overrides.requestId ?? `del-${accountId}`
  const email = overrides.email ?? `${accountId}@nexus.test`

  await h.accounts.save(
    buildActiveAccount({
      id: accountId,
      subject: `sub-${accountId}`,
      email,
      displayName: `Jugador ${accountId}`,
    }),
  )
  await h.requests.save(
    AccountDeletionRequest.receive({
      id: requestId,
      accountId: AccountId.create(accountId),
      notifyEmail: email,
      occurredAt: AT,
    }),
  )

  return { accountId, requestId }
}

describe('ProcessAccountDeletion', () => {
  it('ejecuta el tratamiento completo de una solicitud RECEIVED y la cierra', async () => {
    const h = setup()
    const { accountId, requestId } = await seedAccountWithRequest(h)

    const summary = await h.build().execute()

    expect(summary).toEqual({ processed: 1, closed: 1, failed: 0 })

    const account = await h.accounts.findById(AccountId.create(accountId))
    expect(account?.isDeleted).toBe(true)

    const request = await h.requests.findById(requestId)
    expect(request?.currentStatus).toBe('CLOSED')
    expect(request?.currentClosedAt).toEqual(LATER)

    expect(await h.accounts.findSecurityAnswers(AccountId.create(accountId))).toEqual([])
    expect(h.notifications.sent).toHaveLength(1)
    expect(h.notifications.sent[0]).toMatchObject({
      templateId: ACCOUNT_DELETION_CLOSED_TEMPLATE_ID,
      recipient: `${accountId}@nexus.test`,
    })
  })

  it('retoma una solicitud IN_PROGRESS tras un reinicio simulado, sin duplicar el cierre', async () => {
    const h = setup()
    const { accountId, requestId } = await seedAccountWithRequest(h, { id: 'acc-2' })

    const pending = await h.requests.findById(requestId)
    pending?.beginTreatment()
    if (pending !== null) {
      await h.requests.save(pending)
    }

    const summary = await h.build().execute()

    expect(summary).toEqual({ processed: 1, closed: 1, failed: 0 })
    expect((await h.requests.findById(requestId))?.currentStatus).toBe('CLOSED')
    expect(h.notifications.sent).toHaveLength(1)
    void accountId
  })

  it('marca FAILED sin cerrar cuando el envio de la notificacion falla, y no reintenta sola', async () => {
    const h = setup()
    const { requestId } = await seedAccountWithRequest(h, { id: 'acc-3' })
    h.notifications.failOnce()

    const summary = await h.build().execute()

    expect(summary).toEqual({ processed: 1, closed: 0, failed: 1 })

    const request = await h.requests.findById(requestId)
    expect(request?.currentStatus).toBe('FAILED')
    expect(request?.currentClosedAt).toBeNull()
  })

  it('un reintento tras el fallo completa el tratamiento sin repetir la anonimizacion', async () => {
    const h = setup()
    const { accountId, requestId } = await seedAccountWithRequest(h, { id: 'acc-4' })
    h.notifications.failOnce()

    await h.build().execute()
    expect((await h.requests.findById(requestId))?.currentStatus).toBe('FAILED')

    const account = await h.accounts.findById(AccountId.create(accountId))
    expect(account?.isDeleted).toBe(true) // ya se anonimizo en el primer intento

    const summary = await h.build().execute()

    expect(summary).toEqual({ processed: 1, closed: 1, failed: 0 })
    expect((await h.requests.findById(requestId))?.currentStatus).toBe('CLOSED')
    // Una notificacion del primer intento (que fallo antes de registrarse
    // como enviada) mas la del reintento exitoso.
    expect(h.notifications.sent).toHaveLength(1)
  })

  it('un lote con varias solicitudes: el fallo de una no impide procesar el resto', async () => {
    const h = setup()
    await seedAccountWithRequest(h, { id: 'acc-5' })
    await seedAccountWithRequest(h, { id: 'acc-6' })
    h.notifications.failOnce()

    const summary = await h.build().execute()

    expect(summary).toEqual({ processed: 2, closed: 1, failed: 1 })
  })

  it('respeta el limite de lote', async () => {
    const h = setup()
    await seedAccountWithRequest(h, { id: 'acc-7' })
    await seedAccountWithRequest(h, { id: 'acc-8' })

    const summary = await h.build(1).execute()

    expect(summary.processed).toBe(1)
  })

  it('no encuentra nada que procesar cuando no hay solicitudes pendientes', async () => {
    const h = setup()

    const summary = await h.build().execute()

    expect(summary).toEqual({ processed: 0, closed: 0, failed: 0 })
  })
})
