import { ResolveAppeal } from '../../src/application/use-cases/ResolveAppeal'
import { SubmitAppeal } from '../../src/application/use-cases/SubmitAppeal'
import { InMemoryAccountRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountRepository'
import { InMemorySanctionRepository } from '../../src/adapters/outbound/persistence/InMemorySanctionRepository'
import { InMemoryAppealRepository } from '../../src/adapters/outbound/persistence/InMemoryAppealRepository'
import { Sanction } from '../../src/domain/entities/Sanction'
import { SanctionType } from '../../src/domain/entities/SanctionType'
import { SanctionReasonCode } from '../../src/domain/entities/SanctionReasonCode'
import { AppealDecision } from '../../src/domain/entities/AppealDecision'
import { AccountStatus } from '../../src/domain/entities/AccountStatus'
import { Role } from '../../src/domain/entities/Role'
import { DomainError } from '../../src/domain/errors/DomainError'
import { AppealNotFoundError } from '../../src/application/errors/ApplicationError'
import type {
  NotificationRequest,
  NotificationRequestPort,
} from '../../src/application/ports/NotificationRequestPort'
import { buildActiveAccount } from '../support/account-factory'
import { AccountId } from '../../src/domain/value-objects/AccountId'

const SUBMITTED_AT = new Date('2026-10-05T12:00:00.000Z')
const RESOLVED_AT = new Date('2026-10-08T12:00:00.000Z')

const TARGET_ID = 'target-banned'

const buildHarness = async (sanctionType: SanctionType) => {
  const accounts = new InMemoryAccountRepository()
  const sanctions = new InMemorySanctionRepository()
  const appeals = new InMemoryAppealRepository()

  let counter = 0
  const ids = { generate: (): string => `appeal-${String((counter += 1))}` }
  const clock = { now: (): Date => new Date(SUBMITTED_AT) }

  const requestedNotifications: NotificationRequest[] = []
  const notifications: NotificationRequestPort = {
    request: (notification: NotificationRequest): Promise<void> => {
      requestedNotifications.push(notification)

      return Promise.resolve()
    },
  }

  await accounts.save(
    buildActiveAccount({
      id: 'actor-moderator',
      subject: 'subject-moderator',
      email: 'moderator@nexus.test',
      displayName: 'Moderador',
      roles: [Role.Player, Role.Moderator],
    }),
  )
  await accounts.save(
    buildActiveAccount({
      id: 'actor-admin',
      subject: 'subject-admin',
      email: 'admin@nexus.test',
      displayName: 'Admin',
      roles: [Role.Player, Role.Administrator],
    }),
  )

  const target = buildActiveAccount({
    id: TARGET_ID,
    subject: 'subject-target',
    email: 'target@nexus.test',
    displayName: 'Objetivo',
  })

  const sanction = Sanction.create({
    id: 'sancion-1',
    targetAccountId: TARGET_ID,
    actorAccountId: 'actor-moderator',
    type: sanctionType,
    reason: 'Incumplimiento de las normas.',
    reasonCode: SanctionReasonCode.Harassment,
    createdAt: SUBMITTED_AT,
    expiresAt:
      sanctionType === SanctionType.TemporarySuspension
        ? new Date(SUBMITTED_AT.getTime() + 60 * 60_000)
        : null,
  })

  if (sanctionType === SanctionType.TemporarySuspension) {
    target.suspend()
  }

  if (sanctionType === SanctionType.PermanentBan) {
    target.ban()
  }

  await accounts.save(target)
  await sanctions.save(sanction)

  const submitAppeal = new SubmitAppeal(accounts, sanctions, appeals, ids, clock, notifications)
  const appeal = await submitAppeal.execute({
    accountId: TARGET_ID,
    sanctionId: sanction.id,
    statement: 'La sancion no corresponde a mi conducta.',
  })

  return {
    accounts,
    sanctions,
    appeals,
    requestedNotifications,
    sanction,
    appeal,
    resolveAppeal: new ResolveAppeal(
      accounts,
      sanctions,
      appeals,
      { now: (): Date => new Date(RESOLVED_AT) },
      notifications,
    ),
  }
}

describe('ResolveAppeal (HU-42, §7.3.2)', () => {
  it('OVERTURNED sobre un baneo definitivo levanta el baneo y notifica la resolucion', async () => {
    const harness = await buildHarness(SanctionType.PermanentBan)

    await harness.resolveAppeal.execute({
      actorSubject: 'subject-admin',
      appealId: harness.appeal.id,
      decision: AppealDecision.Overturned,
      notes: 'Se revisaron los registros y la sancion no esta fundamentada.',
    })

    const target = await harness.accounts.findById(AccountId.create(TARGET_ID))
    expect(target?.currentStatus).toBe(AccountStatus.Active)
    expect(target?.canAuthenticate).toBe(true)

    expect(harness.requestedNotifications).toHaveLength(2)
    expect(harness.requestedNotifications[1]).toMatchObject({
      templateId: 'account-appeal-resolved',
      recipient: 'target@nexus.test',
    })
  })

  it('OVERTURNED sobre una suspension temporal reincorpora a la cuenta', async () => {
    const harness = await buildHarness(SanctionType.TemporarySuspension)

    await harness.resolveAppeal.execute({
      actorSubject: 'subject-moderator',
      appealId: harness.appeal.id,
      decision: AppealDecision.Overturned,
      notes: 'La suspension se aplico por error.',
    })

    const target = await harness.accounts.findById(AccountId.create(TARGET_ID))
    expect(target?.currentStatus).toBe(AccountStatus.Active)
  })

  it('UPHELD conserva el baneo sin tocar el estado de la cuenta', async () => {
    const harness = await buildHarness(SanctionType.PermanentBan)

    await harness.resolveAppeal.execute({
      actorSubject: 'subject-admin',
      appealId: harness.appeal.id,
      decision: AppealDecision.Upheld,
      notes: 'La sancion esta debidamente fundamentada.',
    })

    const target = await harness.accounts.findById(AccountId.create(TARGET_ID))
    expect(target?.currentStatus).toBe(AccountStatus.Banned)
  })

  it('rechaza que un Moderador resuelva la apelacion de un baneo definitivo', async () => {
    const harness = await buildHarness(SanctionType.PermanentBan)

    await expect(
      harness.resolveAppeal.execute({
        actorSubject: 'subject-moderator',
        appealId: harness.appeal.id,
        decision: AppealDecision.Overturned,
        notes: 'Intento de un moderador sin autoridad.',
      }),
    ).rejects.toBeInstanceOf(DomainError)

    const target = await harness.accounts.findById(AccountId.create(TARGET_ID))
    expect(target?.currentStatus).toBe(AccountStatus.Banned)
  })

  it('rechaza resolver una apelacion inexistente', async () => {
    const harness = await buildHarness(SanctionType.TemporarySuspension)

    await expect(
      harness.resolveAppeal.execute({
        actorSubject: 'subject-admin',
        appealId: 'apelacion-inexistente',
        decision: AppealDecision.Upheld,
        notes: 'N/A',
      }),
    ).rejects.toBeInstanceOf(AppealNotFoundError)
  })

  it('rechaza resolver dos veces la misma apelacion', async () => {
    const harness = await buildHarness(SanctionType.TemporarySuspension)

    await harness.resolveAppeal.execute({
      actorSubject: 'subject-admin',
      appealId: harness.appeal.id,
      decision: AppealDecision.Upheld,
      notes: 'Primera resolucion.',
    })

    await expect(
      harness.resolveAppeal.execute({
        actorSubject: 'subject-admin',
        appealId: harness.appeal.id,
        decision: AppealDecision.Overturned,
        notes: 'Segundo intento.',
      }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('dos revisiones concurrentes sobre la misma apelacion: solo una gana, la otra ve el conflicto', async () => {
    const harness = await buildHarness(SanctionType.PermanentBan)

    const [first, second] = await Promise.allSettled([
      harness.resolveAppeal.execute({
        actorSubject: 'subject-admin',
        appealId: harness.appeal.id,
        decision: AppealDecision.Upheld,
        notes: 'Primera revision: se mantiene.',
      }),
      harness.resolveAppeal.execute({
        actorSubject: 'subject-admin',
        appealId: harness.appeal.id,
        decision: AppealDecision.Overturned,
        notes: 'Segunda revision: se revierte.',
      }),
    ])

    // Exactamente una de las dos gana la carrera -no importa cual, el punto
    // es que NUNCA las dos tengan exito a la vez-.
    const outcomes = [first, second]
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)

    const rejected = outcomes.find(
      (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
    )
    expect(rejected?.reason).toBeInstanceOf(DomainError)
    expect((rejected?.reason as DomainError).message).toContain('ya fue resuelta')

    // El estado final de la apelacion es el de quien gano, sin mezclar campos.
    const persisted = await harness.appeals.findById(harness.appeal.id)
    expect(persisted?.isResolved).toBe(true)
    expect(['UPHELD', 'OVERTURNED']).toContain(persisted?.currentDecision)
  })

  it('OVERTURNED sobre un baneo aplicado encima de una suspension todavia vigente reinstala la suspension, no deja la cuenta libre', async () => {
    const accounts = new InMemoryAccountRepository()
    const sanctions = new InMemorySanctionRepository()
    const appeals = new InMemoryAppealRepository()
    let counter = 0
    const ids = { generate: (): string => `appeal-${String((counter += 1))}` }
    const notifications: NotificationRequestPort = {
      request: (): Promise<void> => Promise.resolve(),
    }

    await accounts.save(
      buildActiveAccount({
        id: 'actor-admin-2',
        subject: 'subject-admin-2',
        email: 'admin2@nexus.test',
        displayName: 'Admin',
        roles: [Role.Player, Role.Administrator],
      }),
    )

    const target = buildActiveAccount({
      id: 'target-layered',
      subject: 'subject-target-layered',
      email: 'layered@nexus.test',
      displayName: 'Objetivo Apilado',
    })

    // Primero una suspension TODAVIA no vencida...
    const suspension = Sanction.create({
      id: 'sancion-suspension',
      targetAccountId: target.id.value,
      actorAccountId: 'actor-admin-2',
      type: SanctionType.TemporarySuspension,
      reason: 'Primera infraccion.',
      reasonCode: SanctionReasonCode.Harassment,
      createdAt: SUBMITTED_AT,
      expiresAt: new Date(SUBMITTED_AT.getTime() + 24 * 60 * 60_000),
    })
    target.suspend()
    await sanctions.save(suspension)

    // ...y DESPUES un baneo, que `Account.ban()` permite aunque la cuenta ya
    // estuviera suspendida (no exige partir de ACTIVE).
    const ban = Sanction.create({
      id: 'sancion-ban',
      targetAccountId: target.id.value,
      actorAccountId: 'actor-admin-2',
      type: SanctionType.PermanentBan,
      reason: 'Segunda infraccion, mas grave.',
      reasonCode: SanctionReasonCode.FraudOrManipulation,
      createdAt: new Date(SUBMITTED_AT.getTime() + 60_000),
    })
    target.ban()
    await sanctions.save(ban)
    await accounts.save(target)

    const submitAppeal = new SubmitAppeal(
      accounts,
      sanctions,
      appeals,
      ids,
      { now: (): Date => new Date(SUBMITTED_AT.getTime() + 120_000) },
      notifications,
    )
    const appeal = await submitAppeal.execute({
      accountId: target.id.value,
      sanctionId: ban.id,
      statement: 'El baneo es desproporcionado.',
    })

    const resolveAppeal = new ResolveAppeal(
      accounts,
      sanctions,
      appeals,
      { now: (): Date => new Date(SUBMITTED_AT.getTime() + 180_000) },
      notifications,
    )
    await resolveAppeal.execute({
      actorSubject: 'subject-admin-2',
      appealId: appeal.id,
      decision: AppealDecision.Overturned,
      notes: 'El baneo no estaba justificado.',
    })

    const resolved = await accounts.findById(AccountId.create('target-layered'))
    // NO Active: la suspension anterior, todavia vigente, sigue aplicando.
    expect(resolved?.currentStatus).toBe(AccountStatus.Suspended)
  })
})
