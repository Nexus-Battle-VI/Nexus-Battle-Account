import { GetActiveSanctionStatus } from '../../src/application/use-cases/GetActiveSanctionStatus'
import { AccountNotFoundError } from '../../src/application/errors/ApplicationError'
import { InMemoryAccountRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountRepository'
import { InMemorySanctionRepository } from '../../src/adapters/outbound/persistence/InMemorySanctionRepository'
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

const NOW = new Date('2026-09-24T12:00:00.000Z')

const buildAccount = (id: string, status: AccountStatus): Account =>
  Account.restore({
    id: AccountId.create(id),
    subject: `sub:${id}`,
    email: EmailAddress.create(`${id}@nexus.test`),
    displayName: DisplayName.create(`Vendedor ${id}`),
    firstNames: PersonName.create('Vendedor', 'De Pruebas'),
    lastNames: PersonName.create('Apellido', 'De Pruebas'),
    termsAccepted: true,
    avatar: defaultAvatarMetadata(id),
    status,
    roles: [Role.Player],
  })

const fixture = () => {
  const accounts = new InMemoryAccountRepository()
  const sanctions = new InMemorySanctionRepository()
  const useCase = new GetActiveSanctionStatus(accounts, sanctions, { now: () => new Date(NOW) })

  return { accounts, sanctions, useCase }
}

describe('GetActiveSanctionStatus (HU-62)', () => {
  it('responde false para una cuenta activa', async () => {
    const { accounts, useCase } = fixture()
    await accounts.save(buildAccount('vendedor-activo', AccountStatus.Active))

    await expect(useCase.execute('sub:vendedor-activo')).resolves.toBe(false)
  })

  it('responde true para un veto permanente, sin consultar el repositorio de sanciones', async () => {
    const { accounts, sanctions, useCase } = fixture()
    await accounts.save(buildAccount('vendedor-vetado', AccountStatus.Banned))
    const spy = jest.spyOn(sanctions, 'findActiveTemporarySuspension')

    await expect(useCase.execute('sub:vendedor-vetado')).resolves.toBe(true)
    expect(spy).not.toHaveBeenCalled()
  })

  it('responde true para una suspension temporal vigente', async () => {
    const { accounts, sanctions, useCase } = fixture()
    await accounts.save(buildAccount('vendedor-suspendido', AccountStatus.Suspended))
    await sanctions.save(
      Sanction.create({
        id: 'sancion-1',
        targetAccountId: 'vendedor-suspendido',
        actorAccountId: 'moderador-pruebas',
        type: SanctionType.TemporarySuspension,
        reason: 'Comportamiento reportado',
        createdAt: new Date(NOW.getTime() - 60_000),
        expiresAt: new Date(NOW.getTime() + 60_000),
      }),
    )

    await expect(useCase.execute('sub:vendedor-suspendido')).resolves.toBe(true)
  })

  it('responde false para una suspension temporal ya vencida', async () => {
    const { accounts, sanctions, useCase } = fixture()
    await accounts.save(buildAccount('vendedor-vencido', AccountStatus.Suspended))
    await sanctions.save(
      Sanction.create({
        id: 'sancion-2',
        targetAccountId: 'vendedor-vencido',
        actorAccountId: 'moderador-pruebas',
        type: SanctionType.TemporarySuspension,
        reason: 'Comportamiento reportado',
        createdAt: new Date(NOW.getTime() - 120_000),
        expiresAt: new Date(NOW.getTime() - 60_000),
      }),
    )

    await expect(useCase.execute('sub:vendedor-vencido')).resolves.toBe(false)
  })

  it('rechaza un sujeto sin cuenta en este servicio', async () => {
    const { useCase } = fixture()

    await expect(useCase.execute('sub:sin-cuenta')).rejects.toBeInstanceOf(AccountNotFoundError)
  })
})
