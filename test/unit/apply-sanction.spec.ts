import { ApplySanction } from '../../src/application/use-cases/ApplySanction'
import { InMemoryAccountRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountRepository'
import { InMemorySanctionRepository } from '../../src/adapters/outbound/persistence/InMemorySanctionRepository'
import { SanctionType } from '../../src/domain/entities/SanctionType'
import { Role } from '../../src/domain/entities/Role'
import { DomainError } from '../../src/domain/errors/DomainError'
import { AccountNotFoundError } from '../../src/application/errors/ApplicationError'
import { buildActiveAccount } from '../support/account-factory'

const buildHarness = () => {
  const accounts = new InMemoryAccountRepository()
  const sanctions = new InMemorySanctionRepository()

  let counter = 0
  const ids = {
    generate: (): string => {
      counter += 1

      return `sanction-${String(counter)}`
    },
  }

  return {
    accounts,
    sanctions,
    applySanction: new ApplySanction(accounts, sanctions, ids),
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

describe('ApplySanction - HU-42.1', () => {
  it('permite a un moderador registrar una advertencia', async () => {
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
    })

    expect(harness.sanctions.findAll()).toHaveLength(1)
  })

  it('permite a un moderador registrar una suspension temporal', async () => {
    const harness = buildHarness()

    await saveActorAndTarget(harness.accounts, [Role.Moderator])

    const sanction = await harness.applySanction.execute({
      actorSubject: 'actor-subject',
      targetAccountId: 'target-1',
      type: SanctionType.TemporarySuspension,
      reason: 'Incumplimiento reiterado de las normas.',
    })

    expect(sanction.type).toBe(SanctionType.TemporarySuspension)
    expect(harness.sanctions.findAll()).toHaveLength(1)
  })

  it('rechaza que un moderador aplique un baneo permanente', async () => {
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
  })

  it('permite a un administrador aplicar un baneo permanente', async () => {
    const harness = buildHarness()

    await saveActorAndTarget(harness.accounts, [Role.Administrator])

    const sanction = await harness.applySanction.execute({
      actorSubject: 'actor-subject',
      targetAccountId: 'target-1',
      type: SanctionType.PermanentBan,
      reason: 'Incumplimiento grave y reiterado.',
    })

    expect(sanction.type).toBe(SanctionType.PermanentBan)
    expect(harness.sanctions.findAll()).toHaveLength(1)
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
    expect(harness.sanctions.findAll()).toHaveLength(1)
  })

  it('rechaza sanciones aplicadas por un jugador', async () => {
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
  })
})