import { DomainError } from '../../src/domain/errors/DomainError'
import { AccountId } from '../../src/domain/value-objects/AccountId'
import {
  AccountDeletionRequest,
  AccountDeletionRequestStatus,
} from '../../src/domain/entities/AccountDeletionRequest'

const AT = new Date('2026-09-03T12:00:00.000Z')
const LATER = new Date('2026-09-10T09:30:00.000Z')

describe('AccountDeletionRequest', () => {
  it('nace RECEIVED, activa, con la fecha de recepcion generada por backend', () => {
    const request = AccountDeletionRequest.receive({
      id: 'del-1',
      accountId: AccountId.create('acc-1'),
      notifyEmail: 'titular@nexus.test',
      occurredAt: AT,
    })

    expect(request.id).toBe('del-1')
    expect(request.accountId).toBe('acc-1')
    expect(request.currentStatus).toBe(AccountDeletionRequestStatus.Received)
    expect(request.receivedAt).toEqual(AT)
    expect(request.currentClosedAt).toBeNull()
    expect(request.isActive).toBe(true)
  })

  it('exige un identificador no vacio', () => {
    expect(() =>
      AccountDeletionRequest.receive({
        id: '  ',
        accountId: AccountId.create('acc-1'),
        notifyEmail: 'titular@nexus.test',
        occurredAt: AT,
      }),
    ).toThrow(DomainError)
  })

  it('reconstruye exactamente el mismo estado desde una instantanea', () => {
    const original = AccountDeletionRequest.receive({
      id: 'del-2',
      accountId: AccountId.create('acc-2'),
      notifyEmail: 'titular@nexus.test',
      occurredAt: AT,
    })

    const restored = AccountDeletionRequest.restore(original.toSnapshot())

    expect(restored.toSnapshot()).toEqual(original.toSnapshot())
  })

  it('avanza RECEIVED -> IN_PROGRESS -> CLOSED, fijando closedAt al cerrar', () => {
    const request = AccountDeletionRequest.receive({
      id: 'del-3',
      accountId: AccountId.create('acc-3'),
      notifyEmail: 'titular@nexus.test',
      occurredAt: AT,
    })

    request.beginTreatment()
    expect(request.currentStatus).toBe(AccountDeletionRequestStatus.InProgress)
    expect(request.isActive).toBe(true)

    request.close(LATER)
    expect(request.currentStatus).toBe(AccountDeletionRequestStatus.Closed)
    expect(request.currentClosedAt).toEqual(LATER)
    expect(request.isActive).toBe(false)
  })

  it('admite un fallo transitorio en tratamiento y su reintento, sin dejar de estar activa', () => {
    const request = AccountDeletionRequest.receive({
      id: 'del-4',
      accountId: AccountId.create('acc-4'),
      notifyEmail: 'titular@nexus.test',
      occurredAt: AT,
    })
    request.beginTreatment()

    request.markFailed()
    expect(request.currentStatus).toBe(AccountDeletionRequestStatus.Failed)
    expect(request.isActive).toBe(true)

    request.retry()
    expect(request.currentStatus).toBe(AccountDeletionRequestStatus.InProgress)
  })

  it.each([
    [
      'beginTreatment',
      (r: AccountDeletionRequest) => {
        r.beginTreatment()
      },
    ],
    [
      'markFailed',
      (r: AccountDeletionRequest) => {
        r.markFailed()
      },
    ],
    [
      'close',
      (r: AccountDeletionRequest) => {
        r.close(LATER)
      },
    ],
  ])('rechaza %s cuando la solicitud ya esta CLOSED', (_name, action) => {
    const request = AccountDeletionRequest.receive({
      id: 'del-5',
      accountId: AccountId.create('acc-5'),
      notifyEmail: 'titular@nexus.test',
      occurredAt: AT,
    })
    request.beginTreatment()
    request.close(LATER)

    expect(() => {
      action(request)
    }).toThrow(DomainError)
  })

  it('rechaza reintentar una solicitud que no esta FAILED', () => {
    const request = AccountDeletionRequest.receive({
      id: 'del-6',
      accountId: AccountId.create('acc-6'),
      notifyEmail: 'titular@nexus.test',
      occurredAt: AT,
    })

    expect(() => {
      request.retry()
    }).toThrow(DomainError)
  })

  it('rechaza cerrar una solicitud que todavia no inicio tratamiento', () => {
    const request = AccountDeletionRequest.receive({
      id: 'del-7',
      accountId: AccountId.create('acc-7'),
      notifyEmail: 'titular@nexus.test',
      occurredAt: AT,
    })

    expect(() => {
      request.close(LATER)
    }).toThrow(DomainError)
  })
})
