import { SubmitAppeal } from '../../src/application/use-cases/SubmitAppeal'
import { InMemoryAccountRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountRepository'
import { InMemorySanctionRepository } from '../../src/adapters/outbound/persistence/InMemorySanctionRepository'
import { InMemoryAppealRepository } from '../../src/adapters/outbound/persistence/InMemoryAppealRepository'
import { Sanction } from '../../src/domain/entities/Sanction'
import { SanctionType } from '../../src/domain/entities/SanctionType'
import { SanctionReasonCode } from '../../src/domain/entities/SanctionReasonCode'
import { DomainError } from '../../src/domain/errors/DomainError'
import { AccountNotFoundError, SanctionNotFoundError } from '../../src/application/errors/ApplicationError'
import type {
  NotificationRequest,
  NotificationRequestPort,
} from '../../src/application/ports/NotificationRequestPort'
import { buildActiveAccount } from '../support/account-factory'

const NOW = new Date('2026-10-05T12:00:00.000Z')

const buildHarness = () => {
  const accounts = new InMemoryAccountRepository()
  const sanctions = new InMemorySanctionRepository()
  const appeals = new InMemoryAppealRepository()

  let counter = 0
  const ids = { generate: (): string => `appeal-${String((counter += 1))}` }
  const clock = { now: (): Date => new Date(NOW) }

  const requestedNotifications: NotificationRequest[] = []
  const notifications: NotificationRequestPort = {
    request: (notification: NotificationRequest): Promise<void> => {
      requestedNotifications.push(notification)

      return Promise.resolve()
    },
  }

  return {
    accounts,
    sanctions,
    appeals,
    clock,
    requestedNotifications,
    submitAppeal: new SubmitAppeal(accounts, sanctions, appeals, ids, clock, notifications),
  }
}

const SANCTIONED_ACCOUNT_ID = 'account-sancionada'

const seedSanctionedAccount = async (
  accounts: InMemoryAccountRepository,
): Promise<void> => {
  await accounts.save(
    buildActiveAccount({
      id: SANCTIONED_ACCOUNT_ID,
      subject: 'subject-sancionada',
      email: 'sancionada@nexus.test',
      displayName: 'Cuenta Sancionada',
    }),
  )
}

const seedSanction = async (
  sanctions: InMemorySanctionRepository,
  params: { id: string; createdAt: Date; type?: SanctionType },
): Promise<Sanction> => {
  const sanction = Sanction.create({
    id: params.id,
    targetAccountId: SANCTIONED_ACCOUNT_ID,
    actorAccountId: 'moderador-1',
    type: params.type ?? SanctionType.TemporarySuspension,
    reason: 'Incumplimiento de las normas de la comunidad.',
    reasonCode: SanctionReasonCode.Harassment,
    createdAt: params.createdAt,
    expiresAt:
      (params.type ?? SanctionType.TemporarySuspension) === SanctionType.TemporarySuspension
        ? new Date(params.createdAt.getTime() + 60 * 60_000)
        : null,
  })

  await sanctions.save(sanction)

  return sanction
}

describe('SubmitAppeal (HU-42, §7.3.2)', () => {
  it('presenta una apelacion valida y notifica al titular', async () => {
    const harness = buildHarness()

    await seedSanctionedAccount(harness.accounts)
    await seedSanction(harness.sanctions, { id: 'sancion-1', createdAt: NOW })

    const appeal = await harness.submitAppeal.execute({
      accountId: SANCTIONED_ACCOUNT_ID,
      sanctionId: 'sancion-1',
      statement: 'La sancion no corresponde a mi conducta real.',
    })

    expect(appeal.sanctionId).toBe('sancion-1')
    expect(appeal.accountId).toBe(SANCTIONED_ACCOUNT_ID)
    expect(harness.requestedNotifications).toHaveLength(1)
    expect(harness.requestedNotifications[0]).toMatchObject({
      templateId: 'account-appeal-received',
      recipient: 'sancionada@nexus.test',
    })
  })

  it('rechaza apelar una sancion que no existe', async () => {
    const harness = buildHarness()
    await seedSanctionedAccount(harness.accounts)

    await expect(
      harness.submitAppeal.execute({
        accountId: SANCTIONED_ACCOUNT_ID,
        sanctionId: 'sancion-inexistente',
        statement: 'Justificacion.',
      }),
    ).rejects.toBeInstanceOf(SanctionNotFoundError)
  })

  it('rechaza apelar una sancion ajena', async () => {
    const harness = buildHarness()
    await seedSanctionedAccount(harness.accounts)
    await seedSanction(harness.sanctions, { id: 'sancion-1', createdAt: NOW })

    await expect(
      harness.submitAppeal.execute({
        accountId: 'otra-cuenta',
        sanctionId: 'sancion-1',
        statement: 'Justificacion.',
      }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('rechaza apelar fuera del plazo de 30 dias', async () => {
    const harness = buildHarness()
    await seedSanctionedAccount(harness.accounts)
    await seedSanction(harness.sanctions, {
      id: 'sancion-vieja',
      createdAt: new Date(NOW.getTime() - 31 * 24 * 60 * 60 * 1000),
    })

    await expect(
      harness.submitAppeal.execute({
        accountId: SANCTIONED_ACCOUNT_ID,
        sanctionId: 'sancion-vieja',
        statement: 'Justificacion tardia.',
      }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('rechaza una segunda apelacion sobre la misma sancion (idempotencia)', async () => {
    const harness = buildHarness()
    await seedSanctionedAccount(harness.accounts)
    await seedSanction(harness.sanctions, { id: 'sancion-1', createdAt: NOW })

    await harness.submitAppeal.execute({
      accountId: SANCTIONED_ACCOUNT_ID,
      sanctionId: 'sancion-1',
      statement: 'Primera apelacion.',
    })

    await expect(
      harness.submitAppeal.execute({
        accountId: SANCTIONED_ACCOUNT_ID,
        sanctionId: 'sancion-1',
        statement: 'Segunda apelacion.',
      }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('rechaza una cuenta que no existe', async () => {
    const harness = buildHarness()
    await seedSanction(harness.sanctions, { id: 'sancion-huerfana', createdAt: NOW })

    await expect(
      harness.submitAppeal.execute({
        accountId: SANCTIONED_ACCOUNT_ID,
        sanctionId: 'sancion-huerfana',
        statement: 'Justificacion.',
      }),
    ).rejects.toBeInstanceOf(AccountNotFoundError)
  })
})
