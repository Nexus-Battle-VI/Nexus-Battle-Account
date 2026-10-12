import { GetAppealableSanctions } from '../../src/application/use-cases/GetAppealableSanctions'
import { SubmitAppeal } from '../../src/application/use-cases/SubmitAppeal'
import { InMemoryAccountRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountRepository'
import { InMemorySanctionRepository } from '../../src/adapters/outbound/persistence/InMemorySanctionRepository'
import { InMemoryAppealRepository } from '../../src/adapters/outbound/persistence/InMemoryAppealRepository'
import { Sanction } from '../../src/domain/entities/Sanction'
import { SanctionType } from '../../src/domain/entities/SanctionType'
import { SanctionReasonCode } from '../../src/domain/entities/SanctionReasonCode'
import type { NotificationRequestPort } from '../../src/application/ports/NotificationRequestPort'
import { buildActiveAccount } from '../support/account-factory'

const ACCOUNT_ID = 'cuenta-apelable'
const NOW = new Date('2026-10-20T12:00:00.000Z')

describe('GetAppealableSanctions (HU-42, §6 - descubrir sanciones apelables)', () => {
  it('devuelve una sancion dentro del plazo de 30 dias sin apelacion previa', async () => {
    const sanctions = new InMemorySanctionRepository()
    const appeals = new InMemoryAppealRepository()
    const clock = { now: (): Date => NOW }

    const sanction = Sanction.create({
      id: 'sancion-reciente',
      targetAccountId: ACCOUNT_ID,
      actorAccountId: 'actor-1',
      type: SanctionType.Warning,
      reason: 'Lenguaje ofensivo.',
      reasonCode: SanctionReasonCode.OffensiveLanguage,
      createdAt: new Date(NOW.getTime() - 10 * 24 * 60 * 60_000),
    })
    await sanctions.save(sanction)

    const getAppealableSanctions = new GetAppealableSanctions(sanctions, appeals, clock)
    const result = await getAppealableSanctions.execute(ACCOUNT_ID)

    expect(result.map((item) => item.id)).toEqual(['sancion-reciente'])
  })

  it('excluye una sancion fuera del plazo de 30 dias', async () => {
    const sanctions = new InMemorySanctionRepository()
    const appeals = new InMemoryAppealRepository()
    const clock = { now: (): Date => NOW }

    await sanctions.save(
      Sanction.create({
        id: 'sancion-vencida',
        targetAccountId: ACCOUNT_ID,
        actorAccountId: 'actor-1',
        type: SanctionType.PermanentBan,
        reason: 'Fraude.',
        reasonCode: SanctionReasonCode.FraudOrManipulation,
        createdAt: new Date(NOW.getTime() - 40 * 24 * 60 * 60_000),
      }),
    )

    const getAppealableSanctions = new GetAppealableSanctions(sanctions, appeals, clock)
    expect(await getAppealableSanctions.execute(ACCOUNT_ID)).toEqual([])
  })

  it('excluye una sancion que ya tiene una apelacion presentada', async () => {
    const accounts = new InMemoryAccountRepository()
    const sanctions = new InMemorySanctionRepository()
    const appeals = new InMemoryAppealRepository()
    const clock = { now: (): Date => NOW }
    const notifications: NotificationRequestPort = {
      request: (): Promise<void> => Promise.resolve(),
    }

    await accounts.save(
      buildActiveAccount({
        id: ACCOUNT_ID,
        subject: 'subject-apelable',
        email: 'apelable@nexus.test',
        displayName: 'Objetivo Apelable',
      }),
    )

    const sanction = Sanction.create({
      id: 'sancion-ya-apelada',
      targetAccountId: ACCOUNT_ID,
      actorAccountId: 'actor-1',
      type: SanctionType.Warning,
      reason: 'Lenguaje ofensivo.',
      reasonCode: SanctionReasonCode.OffensiveLanguage,
      createdAt: new Date(NOW.getTime() - 5 * 24 * 60 * 60_000),
    })
    await sanctions.save(sanction)

    const submitAppeal = new SubmitAppeal(
      accounts,
      sanctions,
      appeals,
      { generate: (): string => 'apelacion-ya-presentada' },
      clock,
      notifications,
    )
    await submitAppeal.execute({
      accountId: ACCOUNT_ID,
      sanctionId: sanction.id,
      statement: 'Ya presentada.',
    })

    const getAppealableSanctions = new GetAppealableSanctions(sanctions, appeals, clock)
    expect(await getAppealableSanctions.execute(ACCOUNT_ID)).toEqual([])
  })

  it('una cuenta sin sanciones no tiene nada que apelar', async () => {
    const sanctions = new InMemorySanctionRepository()
    const appeals = new InMemoryAppealRepository()
    const getAppealableSanctions = new GetAppealableSanctions(sanctions, appeals, {
      now: (): Date => NOW,
    })

    expect(await getAppealableSanctions.execute('cuenta-sin-historial')).toEqual([])
  })
})
