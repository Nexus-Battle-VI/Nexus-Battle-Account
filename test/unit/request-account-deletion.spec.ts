import { RequestAccountDeletion } from '../../src/application/use-cases/RequestAccountDeletion'
import { InMemoryAccountRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountRepository'
import { InMemoryAccountDeletionRequestRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountDeletionRequestRepository'
import { AccountDeletionRequest } from '../../src/domain/entities/AccountDeletionRequest'
import { AccountId } from '../../src/domain/value-objects/AccountId'
import {
  AccountAlreadyDeletedError,
  AccountHasActiveDeletionRequestError,
  AccountNotFoundError,
} from '../../src/application/errors/ApplicationError'
import type { AccountDeletionRequestRepositoryPort } from '../../src/application/ports/AccountDeletionRequestRepositoryPort'
import { buildActiveAccount } from '../support/account-factory'

const AT = new Date('2026-09-03T12:00:00.000Z')

const fixedClock = { now: (): Date => AT }

const sequentialIds = (prefix: string) => {
  let n = 0

  return {
    generate: (): string => {
      n += 1

      return `${prefix}-${String(n)}`
    },
  }
}

const setup = async () => {
  const accounts = new InMemoryAccountRepository()
  await accounts.save(
    buildActiveAccount({ id: 'acc-propia', subject: 'sub-propia', email: 'ana@nexus.test' }),
  )
  const deletionRequests = new InMemoryAccountDeletionRequestRepository()

  return {
    accounts,
    deletionRequests,
    caso: new RequestAccountDeletion({
      accounts,
      deletionRequests,
      clock: fixedClock,
      ids: sequentialIds('del'),
    }),
  }
}

describe('RequestAccountDeletion', () => {
  it('registra la solicitud, la persiste y confirma RECEPCION', async () => {
    const { caso, deletionRequests } = await setup()

    const dto = await caso.execute('sub-propia')

    expect(dto).toEqual({ id: 'del-1', status: 'RECEIVED', receivedAt: AT.toISOString() })

    const persisted = await deletionRequests.findById('del-1')
    expect(persisted?.accountId).toBe('acc-propia')
    expect(persisted?.currentStatus).toBe('RECEIVED')
  })

  it('rechaza la solicitud cuando el sujeto no tiene cuenta (no crea nada)', async () => {
    const { caso, deletionRequests } = await setup()

    await expect(caso.execute('sujeto-inexistente')).rejects.toThrow(AccountNotFoundError)

    // Ninguna solicitud queda huerfana asociada a un titular que no existe.
    const activa = await deletionRequests.findActiveByAccountId(AccountId.create('acc-propia'))
    expect(activa).toBeNull()
  })

  it('es idempotente: repetir la solicitud mientras hay una activa devuelve la MISMA, sin crear otra', async () => {
    const { caso, deletionRequests } = await setup()

    const primera = await caso.execute('sub-propia')
    const segunda = await caso.execute('sub-propia')

    expect(segunda).toEqual(primera)

    const activa = await deletionRequests.findActiveByAccountId(AccountId.create('acc-propia'))
    expect(activa?.id).toBe(primera.id)
  })

  it('no reactiva una solicitud ya CLOSED: una repeticion posterior crea una nueva', async () => {
    const { caso, deletionRequests } = await setup()

    const primera = await caso.execute('sub-propia')
    const cerrada = await deletionRequests.findById(primera.id)
    cerrada?.beginTreatment()
    cerrada?.close(AT)
    if (cerrada !== null) {
      await deletionRequests.save(cerrada)
    }

    const segunda = await caso.execute('sub-propia')

    expect(segunda.id).not.toBe(primera.id)
    expect(segunda.status).toBe('RECEIVED')
  })

  it('no confirma recepcion si la persistencia falla (no hay exito falso)', async () => {
    const accounts = new InMemoryAccountRepository()
    await accounts.save(
      buildActiveAccount({ id: 'acc-propia', subject: 'sub-propia', email: 'ana@nexus.test' }),
    )

    const fallando: AccountDeletionRequestRepositoryPort = {
      findActiveByAccountId: () => Promise.resolve(null),
      findById: () => Promise.resolve(null),
      findPendingForProcessing: () => Promise.resolve([]),
      save: () => Promise.reject(new Error('la base de datos no respondio')),
    }

    const caso = new RequestAccountDeletion({
      accounts,
      deletionRequests: fallando,
      clock: fixedClock,
      ids: sequentialIds('del'),
    })

    await expect(caso.execute('sub-propia')).rejects.toThrow('la base de datos no respondio')
  })

  it('ante una carrera real (save rechaza por indice unico), recupera y devuelve la solicitud activa en vez de fallar', async () => {
    const accounts = new InMemoryAccountRepository()
    await accounts.save(
      buildActiveAccount({ id: 'acc-propia', subject: 'sub-propia', email: 'ana@nexus.test' }),
    )

    // Simula exactamente la ventana de carrera que HU-43.1 protege a nivel de
    // PostgreSQL: la comprobacion previa no encuentra nada activa (`null`),
    // pero al guardar otra peticion concurrente ya gano y el indice unico
    // parcial rechaza esta. El caso de uso debe recuperar esa solicitud ya
    // ganadora, no fallar ni crear una tercera.
    const ganadora = AccountDeletionRequest.receive({
      id: 'del-ganadora',
      accountId: AccountId.create('acc-propia'),
      notifyEmail: 'ana@nexus.test',
      occurredAt: AT,
    })
    let intento = 0
    const conCarrera: AccountDeletionRequestRepositoryPort = {
      findActiveByAccountId: () => Promise.resolve(intento === 0 ? null : ganadora),
      findById: () => Promise.resolve(ganadora),
      findPendingForProcessing: () => Promise.resolve([]),
      save: () => {
        intento += 1

        return Promise.reject(new AccountHasActiveDeletionRequestError())
      },
    }

    const caso = new RequestAccountDeletion({
      accounts,
      deletionRequests: conCarrera,
      clock: fixedClock,
      ids: sequentialIds('del'),
    })

    const dto = await caso.execute('sub-propia')

    expect(dto.id).toBe('del-ganadora')
  })

  /**
   * HU-43.3: el correo de la notificacion de cierre se captura AQUI, antes de
   * que `Account.erase()` pueda anonimizar `accounts.email`. Sin esto, el
   * proceso de cierre no tendria a donde notificar tras reanudarse desde un
   * reinicio.
   */
  it('captura el correo vigente de la cuenta como notifyEmail de la solicitud', async () => {
    const { caso, deletionRequests } = await setup()

    const dto = await caso.execute('sub-propia')

    const persisted = await deletionRequests.findById(dto.id)
    expect(persisted?.notificationRecipient).toBe('ana@nexus.test')
  })

  /**
   * Sin esta comprobacion, una segunda llamada tras HU-43.3 cerrar la unica
   * solicitud activa crearia una solicitud RECEIVED nueva -no hay ninguna
   * activa que la bloquee, la anterior ya esta CLOSED- y reenviaria la
   * notificacion de cierre en cada repeticion.
   */
  it('rechaza con AccountAlreadyDeletedError una solicitud sobre una cuenta ya eliminada', async () => {
    const { caso, accounts, deletionRequests } = await setup()

    const account = await accounts.findBySubject('sub-propia')
    account?.erase()
    if (account !== null) {
      await accounts.save(account)
    }

    await expect(caso.execute('sub-propia')).rejects.toBeInstanceOf(AccountAlreadyDeletedError)

    // No crea ninguna solicitud nueva ni huerfana.
    const activa = await deletionRequests.findActiveByAccountId(AccountId.create('acc-propia'))
    expect(activa).toBeNull()
  })
})
