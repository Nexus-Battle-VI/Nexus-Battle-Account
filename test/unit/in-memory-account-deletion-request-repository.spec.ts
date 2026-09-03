import { AccountId } from '../../src/domain/value-objects/AccountId'
import { AccountDeletionRequest } from '../../src/domain/entities/AccountDeletionRequest'
import { InMemoryAccountDeletionRequestRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountDeletionRequestRepository'
import { AccountHasActiveDeletionRequestError } from '../../src/application/errors/ApplicationError'

const AT = new Date('2026-09-03T12:00:00.000Z')

describe('InMemoryAccountDeletionRequestRepository', () => {
  it('guarda y recupera una solicitud por su identificador', async () => {
    const repository = new InMemoryAccountDeletionRequestRepository()
    const request = AccountDeletionRequest.receive({
      id: 'del-1',
      accountId: AccountId.create('acc-1'),
      occurredAt: AT,
    })

    await repository.save(request)
    const found = await repository.findById('del-1')

    expect(found?.toSnapshot()).toEqual(request.toSnapshot())
  })

  it('devuelve null cuando el identificador no existe', async () => {
    const repository = new InMemoryAccountDeletionRequestRepository()

    expect(await repository.findById('inexistente')).toBeNull()
  })

  it('encuentra la solicitud activa de una cuenta', async () => {
    const repository = new InMemoryAccountDeletionRequestRepository()
    const request = AccountDeletionRequest.receive({
      id: 'del-2',
      accountId: AccountId.create('acc-2'),
      occurredAt: AT,
    })
    await repository.save(request)

    const found = await repository.findActiveByAccountId(AccountId.create('acc-2'))

    expect(found?.id).toBe('del-2')
  })

  it('no encuentra solicitud activa cuando la unica que existe ya esta CLOSED', async () => {
    const repository = new InMemoryAccountDeletionRequestRepository()
    const request = AccountDeletionRequest.receive({
      id: 'del-3',
      accountId: AccountId.create('acc-3'),
      occurredAt: AT,
    })
    request.beginTreatment()
    request.close(AT)
    await repository.save(request)

    expect(await repository.findActiveByAccountId(AccountId.create('acc-3'))).toBeNull()
  })

  it('rechaza una segunda solicitud activa para la misma cuenta', async () => {
    const repository = new InMemoryAccountDeletionRequestRepository()
    const accountId = AccountId.create('acc-4')
    await repository.save(
      AccountDeletionRequest.receive({ id: 'del-4a', accountId, occurredAt: AT }),
    )

    await expect(
      repository.save(AccountDeletionRequest.receive({ id: 'del-4b', accountId, occurredAt: AT })),
    ).rejects.toThrow(AccountHasActiveDeletionRequestError)
  })

  it('permite una solicitud nueva si la anterior de la cuenta ya esta CLOSED', async () => {
    const repository = new InMemoryAccountDeletionRequestRepository()
    const accountId = AccountId.create('acc-5')
    const first = AccountDeletionRequest.receive({ id: 'del-5a', accountId, occurredAt: AT })
    first.beginTreatment()
    first.close(AT)
    await repository.save(first)

    await expect(
      repository.save(AccountDeletionRequest.receive({ id: 'del-5b', accountId, occurredAt: AT })),
    ).resolves.toBeUndefined()
  })

  it('permite persistir el avance de estado de la MISMA solicitud (mismo id)', async () => {
    const repository = new InMemoryAccountDeletionRequestRepository()
    const request = AccountDeletionRequest.receive({
      id: 'del-6',
      accountId: AccountId.create('acc-6'),
      occurredAt: AT,
    })
    await repository.save(request)

    request.beginTreatment()
    await repository.save(request)

    const found = await repository.findById('del-6')

    expect(found?.currentStatus).toBe('IN_PROGRESS')
  })

  describe('claimNextPending (HU-43.3)', () => {
    it('devuelve null cuando no hay ninguna solicitud pendiente', async () => {
      const repository = new InMemoryAccountDeletionRequestRepository()

      expect(await repository.claimNextPending()).toBeNull()
    })

    it('reclama una RECEIVED y la deja IN_PROGRESS', async () => {
      const repository = new InMemoryAccountDeletionRequestRepository()
      await repository.save(
        AccountDeletionRequest.receive({
          id: 'del-7',
          accountId: AccountId.create('acc-7'),
          occurredAt: AT,
        }),
      )

      const claimed = await repository.claimNextPending()

      expect(claimed?.id).toBe('del-7')
      expect(claimed?.currentStatus).toBe('IN_PROGRESS')
      expect((await repository.findById('del-7'))?.currentStatus).toBe('IN_PROGRESS')
    })

    it('reclama una FAILED y la reintenta (queda IN_PROGRESS)', async () => {
      const repository = new InMemoryAccountDeletionRequestRepository()
      const request = AccountDeletionRequest.receive({
        id: 'del-8',
        accountId: AccountId.create('acc-8'),
        occurredAt: AT,
      })
      request.beginTreatment()
      request.markFailed()
      await repository.save(request)

      const claimed = await repository.claimNextPending()

      expect(claimed?.currentStatus).toBe('IN_PROGRESS')
    })

    it('reclama de nuevo una IN_PROGRESS sin lanzar (reanudacion tras interrupcion)', async () => {
      const repository = new InMemoryAccountDeletionRequestRepository()
      const request = AccountDeletionRequest.receive({
        id: 'del-9',
        accountId: AccountId.create('acc-9'),
        occurredAt: AT,
      })
      request.beginTreatment()
      await repository.save(request)

      const claimed = await repository.claimNextPending()

      expect(claimed?.id).toBe('del-9')
      expect(claimed?.currentStatus).toBe('IN_PROGRESS')
    })

    it('nunca reclama una solicitud ya CLOSED', async () => {
      const repository = new InMemoryAccountDeletionRequestRepository()
      const request = AccountDeletionRequest.receive({
        id: 'del-10',
        accountId: AccountId.create('acc-10'),
        occurredAt: AT,
      })
      request.beginTreatment()
      request.close(AT)
      await repository.save(request)

      expect(await repository.claimNextPending()).toBeNull()
    })

    it('reclama primero la solicitud pendiente mas antigua', async () => {
      const repository = new InMemoryAccountDeletionRequestRepository()
      const reciente = AccountDeletionRequest.receive({
        id: 'del-11',
        accountId: AccountId.create('acc-11'),
        occurredAt: new Date('2026-09-05T00:00:00.000Z'),
      })
      const antigua = AccountDeletionRequest.receive({
        id: 'del-12',
        accountId: AccountId.create('acc-12'),
        occurredAt: new Date('2026-09-01T00:00:00.000Z'),
      })
      await repository.save(reciente)
      await repository.save(antigua)

      expect((await repository.claimNextPending())?.id).toBe('del-12')
    })
  })
})
