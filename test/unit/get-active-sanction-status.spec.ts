import { GetActiveSanctionStatus } from '../../src/application/use-cases/GetActiveSanctionStatus'
import { AccountNotFoundError } from '../../src/application/errors/ApplicationError'
import { InMemoryAccountRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountRepository'
import { InMemorySanctionRepository } from '../../src/adapters/outbound/persistence/InMemorySanctionRepository'
import { Account } from '../../src/domain/entities/Account'
import { AccountStatus } from '../../src/domain/entities/AccountStatus'
import { Role } from '../../src/domain/entities/Role'
import { Sanction } from '../../src/domain/entities/Sanction'
import { SanctionReasonCode } from '../../src/domain/entities/SanctionReasonCode'
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

const suspension = (
  id: string,
  targetAccountId: string,
  expiresInMs: number,
  reasonCode: SanctionReasonCode = SanctionReasonCode.Other,
): Sanction =>
  Sanction.create({
    id,
    targetAccountId,
    actorAccountId: 'moderador-pruebas',
    type: SanctionType.TemporarySuspension,
    reason: 'Comportamiento reportado',
    reasonCode,
    createdAt: new Date(NOW.getTime() - 120_000),
    expiresAt: new Date(NOW.getTime() + expiresInMs),
  })

describe('GetActiveSanctionStatus (HU-62)', () => {
  it('responde sin sanciones para una cuenta activa', async () => {
    const { accounts, useCase } = fixture()
    await accounts.save(buildAccount('vendedor-activo', AccountStatus.Active))

    await expect(useCase.execute('sub:vendedor-activo')).resolves.toEqual({
      hasActiveSanctions: false,
      sanctions: [],
    })
  })

  it('lista el veto permanente con su código de motivo', async () => {
    const { accounts, sanctions, useCase } = fixture()
    await accounts.save(buildAccount('vendedor-vetado', AccountStatus.Banned))
    await sanctions.save(
      Sanction.create({
        id: 'veto-1',
        targetAccountId: 'vendedor-vetado',
        actorAccountId: 'administrador-pruebas',
        type: SanctionType.PermanentBan,
        reason: 'Fraude reiterado',
        reasonCode: SanctionReasonCode.Other,
        createdAt: new Date(NOW.getTime() - 60_000),
      }),
    )

    const status = await useCase.execute('sub:vendedor-vetado')

    expect(status.hasActiveSanctions).toBe(true)
    expect(status.sanctions).toHaveLength(1)
    expect(status.sanctions[0]).toMatchObject({
      id: 'veto-1',
      type: SanctionType.PermanentBan,
      reasonCode: SanctionReasonCode.Other,
      expiresAt: null,
    })
  })

  it('mantiene el bloqueo de un veto aunque no exista fila de sanción asociada', async () => {
    const { accounts, useCase } = fixture()
    await accounts.save(buildAccount('vetado-sin-fila', AccountStatus.Banned))

    await expect(useCase.execute('sub:vetado-sin-fila')).resolves.toEqual({
      hasActiveSanctions: true,
      sanctions: [],
    })
  })

  it('lista una suspension temporal vigente con su código de motivo', async () => {
    const { accounts, sanctions, useCase } = fixture()
    await accounts.save(buildAccount('vendedor-suspendido', AccountStatus.Suspended))
    await sanctions.save(
      suspension(
        'sancion-1',
        'vendedor-suspendido',
        60_000,
        SanctionReasonCode.AuctionTermsViolation,
      ),
    )

    const status = await useCase.execute('sub:vendedor-suspendido')

    expect(status.hasActiveSanctions).toBe(true)
    expect(status.sanctions).toHaveLength(1)
    expect(status.sanctions[0]).toMatchObject({
      id: 'sancion-1',
      type: SanctionType.TemporarySuspension,
      reasonCode: SanctionReasonCode.AuctionTermsViolation,
    })
  })

  it('no lista una suspension temporal ya vencida', async () => {
    const { accounts, sanctions, useCase } = fixture()
    await accounts.save(buildAccount('vendedor-vencido', AccountStatus.Suspended))
    await sanctions.save(suspension('sancion-2', 'vendedor-vencido', -60_000))

    await expect(useCase.execute('sub:vendedor-vencido')).resolves.toEqual({
      hasActiveSanctions: false,
      sanctions: [],
    })
  })

  it('no lista advertencias aunque tengan el código de Auction', async () => {
    const { accounts, sanctions, useCase } = fixture()
    await accounts.save(buildAccount('vendedor-advertido', AccountStatus.Active))
    await sanctions.save(
      Sanction.create({
        id: 'advertencia-1',
        targetAccountId: 'vendedor-advertido',
        actorAccountId: 'moderador-pruebas',
        type: SanctionType.Warning,
        reason: 'Aviso',
        reasonCode: SanctionReasonCode.AuctionTermsViolation,
        createdAt: new Date(NOW.getTime() - 60_000),
      }),
    )

    await expect(useCase.execute('sub:vendedor-advertido')).resolves.toEqual({
      hasActiveSanctions: false,
      sanctions: [],
    })
  })

  it('rechaza un sujeto sin cuenta en este servicio', async () => {
    const { useCase } = fixture()

    await expect(useCase.execute('sub:sin-cuenta')).rejects.toBeInstanceOf(AccountNotFoundError)
  })
})
