import { ApplySanction } from '../../src/application/use-cases/ApplySanction'
import { InMemoryAccountRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountRepository'
import { InMemorySanctionRepository } from '../../src/adapters/outbound/persistence/InMemorySanctionRepository'
import { InMemorySanctionPersistence } from '../../src/adapters/outbound/persistence/InMemorySanctionPersistence'
import { AccountStatus } from '../../src/domain/entities/AccountStatus'
import { SanctionType } from '../../src/domain/entities/SanctionType'
import { Role } from '../../src/domain/entities/Role'
import { DomainError } from '../../src/domain/errors/DomainError'
import { AccountNotFoundError } from '../../src/application/errors/ApplicationError'
import { AccountId } from '../../src/domain/value-objects/AccountId'
import { buildActiveAccount } from '../support/account-factory'

const NOW = new Date('2026-09-06T12:00:00.000Z')
const TARGET_ID = AccountId.create('target-1')

const buildHarness = () => {
  const accounts = new InMemoryAccountRepository()
  const sanctions = new InMemorySanctionRepository()
  const persistence = new InMemorySanctionPersistence(accounts, sanctions)

  let counter = 0

  const ids = {
    generate: (): string => {
      counter += 1

      return `sanction-${String(counter)}`
    },
  }

  const clock = {
    now: (): Date => new Date(NOW),
  }

  return {
    accounts,
    sanctions,
    persistence,
    clock,
    applySanction: new ApplySanction(accounts, persistence, ids, clock),
  }
}

const saveActorAndTarget = async (
  accounts: InMemoryAccountRepository,
  actorRoles: readonly Role[],
): Promise<void> => {
  await accounts.save(
    buildActiveAccount({
      id: 'actor-1',
      subject: 'actor-subject',
      email: 'actor@nexus.test',
      displayName: 'Actor Moderacion',
      roles: actorRoles,
    }),
  )

  await accounts.save(
    buildActiveAccount({
      id: 'target-1',
      subject: 'target-subject',
      email: 'target@nexus.test',
      displayName: 'Usuario Objetivo',
      roles: [Role.Player],
    }),
  )
}

describe('ApplySanction - HU-42.1 / HU-42.2', () => {
  it('permite a un moderador registrar una advertencia sin restringir el acceso', async () => {
    const harness = buildHarness()

    await saveActorAndTarget(harness.accounts, [Role.Moderator])

    const sanction = await harness.applySanction.execute({
      actorSubject: 'actor-subject',
      targetAccountId: 'target-1',
      type: SanctionType.Warning,
      reason: 'Conducta ofensiva reiterada.',
    })

    expect(sanction.toSnapshot()).toMatchObject({
      id: 'sanction-1',
      targetAccountId: 'target-1',
      actorAccountId: 'actor-1',
      type: SanctionType.Warning,
      reason: 'Conducta ofensiva reiterada.',
      expiresAt: null,
    })

    expect(harness.sanctions.findAll()).toHaveLength(1)

    const target = await harness.accounts.findById(TARGET_ID)

    expect(target?.currentStatus).toBe(AccountStatus.Active)

    expect(target?.canAuthenticate).toBe(true)
  })

  it('permite a un moderador registrar una suspension temporal y restringe el acceso', async () => {
    const harness = buildHarness()

    await saveActorAndTarget(harness.accounts, [Role.Moderator])

    const sanction = await harness.applySanction.execute({
      actorSubject: 'actor-subject',
      targetAccountId: 'target-1',
      type: SanctionType.TemporarySuspension,
      reason: 'Incumplimiento reiterado de las normas.',
      suspensionDurationMinutes: 60,
    })

    expect(sanction.type).toBe(SanctionType.TemporarySuspension)

    expect(sanction.toSnapshot().expiresAt).toEqual(new Date('2026-09-06T13:00:00.000Z'))

    expect(harness.sanctions.findAll()).toHaveLength(1)

    const target = await harness.accounts.findById(TARGET_ID)

    expect(target?.currentStatus).toBe(AccountStatus.Suspended)

    expect(target?.canAuthenticate).toBe(false)
  })

  it('permite configurar la duracion de una suspension temporal', async () => {
    const harness = buildHarness()

    await saveActorAndTarget(harness.accounts, [Role.Moderator])

    const sanction = await harness.applySanction.execute({
      actorSubject: 'actor-subject',
      targetAccountId: 'target-1',
      type: SanctionType.TemporarySuspension,
      reason: 'Suspension configurable.',
      suspensionDurationMinutes: 90,
    })

    expect(sanction.toSnapshot().expiresAt).toEqual(new Date('2026-09-06T13:30:00.000Z'))
  })

  it('rechaza una suspension temporal sin duracion y no restringe el acceso', async () => {
    const harness = buildHarness()

    await saveActorAndTarget(harness.accounts, [Role.Moderator])

    await expect(
      harness.applySanction.execute({
        actorSubject: 'actor-subject',
        targetAccountId: 'target-1',
        type: SanctionType.TemporarySuspension,
        reason: 'Suspension sin duracion.',
      }),
    ).rejects.toBeInstanceOf(DomainError)

    expect(harness.sanctions.findAll()).toHaveLength(0)

    const target = await harness.accounts.findById(TARGET_ID)

    expect(target?.currentStatus).toBe(AccountStatus.Active)

    expect(target?.canAuthenticate).toBe(true)
  })

  it('rechaza una duracion invalida de suspension y no restringe el acceso', async () => {
    const harness = buildHarness()

    await saveActorAndTarget(harness.accounts, [Role.Moderator])

    await expect(
      harness.applySanction.execute({
        actorSubject: 'actor-subject',
        targetAccountId: 'target-1',
        type: SanctionType.TemporarySuspension,
        reason: 'Suspension invalida.',
        suspensionDurationMinutes: 0,
      }),
    ).rejects.toBeInstanceOf(DomainError)

    expect(harness.sanctions.findAll()).toHaveLength(0)

    const target = await harness.accounts.findById(TARGET_ID)

    expect(target?.currentStatus).toBe(AccountStatus.Active)

    expect(target?.canAuthenticate).toBe(true)
  })

  it('rechaza que una advertencia reciba duracion de suspension', async () => {
    const harness = buildHarness()

    await saveActorAndTarget(harness.accounts, [Role.Moderator])

    await expect(
      harness.applySanction.execute({
        actorSubject: 'actor-subject',
        targetAccountId: 'target-1',
        type: SanctionType.Warning,
        reason: 'Advertencia.',
        suspensionDurationMinutes: 30,
      }),
    ).rejects.toBeInstanceOf(DomainError)

    expect(harness.sanctions.findAll()).toHaveLength(0)

    const target = await harness.accounts.findById(TARGET_ID)

    expect(target?.currentStatus).toBe(AccountStatus.Active)

    expect(target?.canAuthenticate).toBe(true)
  })

  it('rechaza que un moderador aplique un baneo permanente y no altera el acceso', async () => {
    const harness = buildHarness()

    await saveActorAndTarget(harness.accounts, [Role.Moderator])

    await expect(
      harness.applySanction.execute({
        actorSubject: 'actor-subject',
        targetAccountId: 'target-1',
        type: SanctionType.PermanentBan,
        reason: 'Conducta grave.',
      }),
    ).rejects.toBeInstanceOf(DomainError)

    expect(harness.sanctions.findAll()).toHaveLength(0)

    const target = await harness.accounts.findById(TARGET_ID)

    expect(target?.currentStatus).toBe(AccountStatus.Active)

    expect(target?.canAuthenticate).toBe(true)
  })

  it('permite a un administrador aplicar un baneo permanente y restringe definitivamente el acceso', async () => {
    const harness = buildHarness()

    await saveActorAndTarget(harness.accounts, [Role.Administrator])

    const sanction = await harness.applySanction.execute({
      actorSubject: 'actor-subject',
      targetAccountId: 'target-1',
      type: SanctionType.PermanentBan,
      reason: 'Incumplimiento grave y reiterado.',
    })

    expect(sanction.type).toBe(SanctionType.PermanentBan)

    expect(sanction.toSnapshot().expiresAt).toBeNull()

    expect(harness.sanctions.findAll()).toHaveLength(1)

    const target = await harness.accounts.findById(TARGET_ID)

    expect(target?.currentStatus).toBe(AccountStatus.Banned)

    expect(target?.canAuthenticate).toBe(false)
  })

  it('permite a un super administrador aplicar un baneo permanente', async () => {
    const harness = buildHarness()

    await saveActorAndTarget(harness.accounts, [Role.SuperAdministrator])

    const sanction = await harness.applySanction.execute({
      actorSubject: 'actor-subject',
      targetAccountId: 'target-1',
      type: SanctionType.PermanentBan,
      reason: 'Violacion grave de las reglas.',
    })

    expect(sanction.type).toBe(SanctionType.PermanentBan)

    const target = await harness.accounts.findById(TARGET_ID)

    expect(target?.currentStatus).toBe(AccountStatus.Banned)

    expect(target?.canAuthenticate).toBe(false)
  })

  it('rechaza sanciones aplicadas por un jugador y mantiene la cuenta activa', async () => {
    const harness = buildHarness()

    await saveActorAndTarget(harness.accounts, [Role.Player])

    await expect(
      harness.applySanction.execute({
        actorSubject: 'actor-subject',
        targetAccountId: 'target-1',
        type: SanctionType.Warning,
        reason: 'Intento no autorizado.',
      }),
    ).rejects.toBeInstanceOf(DomainError)

    expect(harness.sanctions.findAll()).toHaveLength(0)

    const target = await harness.accounts.findById(TARGET_ID)

    expect(target?.currentStatus).toBe(AccountStatus.Active)

    expect(target?.canAuthenticate).toBe(true)
  })

  it('rechaza una sancion cuando el actor no existe', async () => {
    const harness = buildHarness()

    await harness.accounts.save(
      buildActiveAccount({
        id: 'target-1',
        subject: 'target-subject',
        email: 'target@nexus.test',
        roles: [Role.Player],
      }),
    )

    await expect(
      harness.applySanction.execute({
        actorSubject: 'actor-inexistente',
        targetAccountId: 'target-1',
        type: SanctionType.Warning,
        reason: 'Motivo de prueba.',
      }),
    ).rejects.toBeInstanceOf(AccountNotFoundError)

    expect(harness.sanctions.findAll()).toHaveLength(0)

    const target = await harness.accounts.findById(TARGET_ID)

    expect(target?.currentStatus).toBe(AccountStatus.Active)
  })

  it('rechaza una sancion cuando el usuario objetivo no existe', async () => {
    const harness = buildHarness()

    await harness.accounts.save(
      buildActiveAccount({
        id: 'actor-1',
        subject: 'actor-subject',
        email: 'actor@nexus.test',
        roles: [Role.Moderator],
      }),
    )

    await expect(
      harness.applySanction.execute({
        actorSubject: 'actor-subject',
        targetAccountId: 'target-inexistente',
        type: SanctionType.Warning,
        reason: 'Motivo de prueba.',
      }),
    ).rejects.toBeInstanceOf(AccountNotFoundError)

    expect(harness.sanctions.findAll()).toHaveLength(0)
  })

  it('rechaza una causal vacia y no deja registros parciales', async () => {
    const harness = buildHarness()

    await saveActorAndTarget(harness.accounts, [Role.Moderator])

    await expect(
      harness.applySanction.execute({
        actorSubject: 'actor-subject',
        targetAccountId: 'target-1',
        type: SanctionType.Warning,
        reason: '   ',
      }),
    ).rejects.toBeInstanceOf(DomainError)

    expect(harness.sanctions.findAll()).toHaveLength(0)

    const target = await harness.accounts.findById(TARGET_ID)

    expect(target?.currentStatus).toBe(AccountStatus.Active)

    expect(target?.canAuthenticate).toBe(true)
  })
})
