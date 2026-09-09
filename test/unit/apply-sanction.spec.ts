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
import type {
  NotificationRequest,
  NotificationRequestPort,
} from '../../src/application/ports/NotificationRequestPort'
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

  const requestedNotifications: NotificationRequest[] = []

  const notifications: NotificationRequestPort = {
    request: (
      notification: NotificationRequest,
    ): Promise<void> => {
      requestedNotifications.push(notification)

      return Promise.resolve()
    },
  }

  return {
    accounts,
    sanctions,
    persistence,
    clock,
    notifications,
    requestedNotifications,
    applySanction: new ApplySanction(
      accounts,
      persistence,
      ids,
      clock,
      notifications,
    ),
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

describe('ApplySanction - HU-42.1 / HU-42.2 / HU-42.3', () => {
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

    expect(sanction.type).toBe(
      SanctionType.TemporarySuspension,
    )

    expect(sanction.toSnapshot().expiresAt).toEqual(
      new Date('2026-09-06T13:00:00.000Z'),
    )

    expect(harness.sanctions.findAll()).toHaveLength(1)

    const target = await harness.accounts.findById(TARGET_ID)

    expect(target?.currentStatus).toBe(
      AccountStatus.Suspended,
    )

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

    expect(sanction.toSnapshot().expiresAt).toEqual(
      new Date('2026-09-06T13:30:00.000Z'),
    )
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

    await saveActorAndTarget(harness.accounts, [
      Role.Administrator,
    ])

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

    await saveActorAndTarget(harness.accounts, [
      Role.SuperAdministrator,
    ])

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

  it('solicita una notificacion cuando la sancion se aplica correctamente', async () => {
    const harness = buildHarness()

    await saveActorAndTarget(harness.accounts, [Role.Moderator])

    await harness.applySanction.execute({
      actorSubject: 'actor-subject',
      targetAccountId: 'target-1',
      type: SanctionType.Warning,
      reason: 'Conducta ofensiva.',
    })

    expect(harness.requestedNotifications).toHaveLength(1)

    expect(harness.requestedNotifications[0]).toEqual({
      notificationId: 'sanction-sanction-1',
      recipient: 'target@nexus.test',
      templateId: 'account-sanction-applied',
      variables: {
        displayName: 'Usuario Objetivo',
        sanctionId: 'sanction-1',
        sanctionType: SanctionType.Warning,
        reason: 'Conducta ofensiva.',
        appliedAt: '2026-09-06T12:00:00.000Z',
        appealDeadline: '2026-10-06T12:00:00.000Z',
        appealWindowDays: 30,
        expiresAt: '',
      },
    })
  })

  it('incluye la expiracion de la suspension temporal en la notificacion', async () => {
    const harness = buildHarness()

    await saveActorAndTarget(harness.accounts, [Role.Moderator])

    await harness.applySanction.execute({
      actorSubject: 'actor-subject',
      targetAccountId: 'target-1',
      type: SanctionType.TemporarySuspension,
      reason: 'Suspension de prueba.',
      suspensionDurationMinutes: 60,
    })

    expect(harness.requestedNotifications).toHaveLength(1)

    expect(
      harness.requestedNotifications[0]?.variables,
    ).toMatchObject({
      sanctionType: SanctionType.TemporarySuspension,
      appealWindowDays: 30,
      appealDeadline: '2026-10-06T12:00:00.000Z',
      expiresAt: '2026-09-06T13:00:00.000Z',
    })
  })

  it('no solicita una notificacion cuando la sancion es rechazada', async () => {
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
    expect(harness.requestedNotifications).toHaveLength(0)
  })

  it('persiste la sancion antes de solicitar la notificacion', async () => {
    const harness = buildHarness()

    await saveActorAndTarget(harness.accounts, [Role.Moderator])

    let sanctionWasPersistedBeforeNotification = false

    const notifications: NotificationRequestPort = {
      request: (): Promise<void> => {
        sanctionWasPersistedBeforeNotification =
          harness.sanctions.findAll().length === 1

        return Promise.resolve()
      },
    }

    const applySanction = new ApplySanction(
      harness.accounts,
      harness.persistence,
      {
        generate: (): string => 'sanction-order-test',
      },
      harness.clock,
      notifications,
    )

    await applySanction.execute({
      actorSubject: 'actor-subject',
      targetAccountId: 'target-1',
      type: SanctionType.Warning,
      reason: 'Validar orden.',
    })

    expect(
      sanctionWasPersistedBeforeNotification,
    ).toBe(true)
  })

  it('mantiene la sancion aplicada aunque falle el servicio de notificaciones', async () => {
    const accounts = new InMemoryAccountRepository()
    const sanctions = new InMemorySanctionRepository()
    const persistence = new InMemorySanctionPersistence(
      accounts,
      sanctions,
    )

    await saveActorAndTarget(accounts, [Role.Moderator])

    const notifications: NotificationRequestPort = {
      request: (): Promise<void> =>
        Promise.reject(
          new Error('Notifications no disponible'),
        ),
    }

    const applySanction = new ApplySanction(
      accounts,
      persistence,
      {
        generate: (): string => 'sanction-failure-test',
      },
      {
        now: (): Date => new Date(NOW),
      },
      notifications,
    )

    await expect(
      applySanction.execute({
        actorSubject: 'actor-subject',
        targetAccountId: 'target-1',
        type: SanctionType.Warning,
        reason: 'Prueba de fallo de correo.',
      }),
    ).rejects.toThrow('Notifications no disponible')

    expect(sanctions.findAll()).toHaveLength(1)
  })
})