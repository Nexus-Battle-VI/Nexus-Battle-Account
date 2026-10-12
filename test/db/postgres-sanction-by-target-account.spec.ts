import 'reflect-metadata'

import type { Kysely } from 'kysely'

import { PostgresSanctionRepository } from '../../src/adapters/outbound/persistence/PostgresSanctionRepository'
import type { Database } from '../../src/adapters/outbound/persistence/schema'
import { Sanction } from '../../src/domain/entities/Sanction'
import { SanctionReasonCode } from '../../src/domain/entities/SanctionReasonCode'
import { SanctionType } from '../../src/domain/entities/SanctionType'
import { createDatabase, migrateToLatest } from '../../src/infrastructure/persistence/database'
import { startTestPostgres, type TestPostgres } from './postgres-runtime'

const AT = new Date('2026-10-20T10:00:00.000Z')

describe('findByTargetAccountId en PostgreSQL (HU-42, §6 - descubrir sanciones apelables)', () => {
  let container: TestPostgres
  let db: Kysely<Database>
  let repository: PostgresSanctionRepository

  beforeAll(async () => {
    container = await startTestPostgres()
    db = createDatabase({ connectionString: container.getConnectionUri(), maxConnections: 2 })
    const outcome = await migrateToLatest(db)
    expect(outcome.error).toBeUndefined()
    repository = new PostgresSanctionRepository(db)
  })

  afterAll(async () => {
    await db.destroy()
    await container.stop()
  })

  beforeEach(async () => {
    await db.deleteFrom('sanctions').execute()
  })

  it('devuelve todo el historial de una cuenta, mas reciente primero, sin filtrar por tipo ni vigencia', async () => {
    await repository.save(
      Sanction.create({
        id: 'historial-antiguo',
        targetAccountId: 'cuenta-historial-db',
        actorAccountId: 'moderador-db',
        type: SanctionType.Warning,
        reason: 'Primer aviso.',
        reasonCode: SanctionReasonCode.OffensiveLanguage,
        createdAt: new Date(AT.getTime() - 120 * 60_000),
      }),
    )
    await repository.save(
      Sanction.create({
        id: 'historial-reciente',
        targetAccountId: 'cuenta-historial-db',
        actorAccountId: 'moderador-db',
        type: SanctionType.PermanentBan,
        reason: 'Fraude confirmado.',
        reasonCode: SanctionReasonCode.FraudOrManipulation,
        createdAt: new Date(AT.getTime() - 60_000),
      }),
    )

    const history = await repository.findByTargetAccountId('cuenta-historial-db')

    expect(history.map((sanction) => sanction.id)).toEqual([
      'historial-reciente',
      'historial-antiguo',
    ])
  })

  it('no mezcla el historial de distintas cuentas', async () => {
    await repository.save(
      Sanction.create({
        id: 'de-otra-cuenta',
        targetAccountId: 'cuenta-ajena-db',
        actorAccountId: 'moderador-db',
        type: SanctionType.Warning,
        reason: 'Aviso a otra cuenta.',
        reasonCode: SanctionReasonCode.OffensiveLanguage,
        createdAt: AT,
      }),
    )

    await expect(repository.findByTargetAccountId('cuenta-sin-historial-db')).resolves.toEqual([])
  })
})
