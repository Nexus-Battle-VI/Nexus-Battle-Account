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
})
