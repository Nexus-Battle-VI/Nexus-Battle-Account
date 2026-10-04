import 'reflect-metadata'

import { sql, type Kysely } from 'kysely'

import { PostgresSanctionRepository } from '../../src/adapters/outbound/persistence/PostgresSanctionRepository'
import type { Database } from '../../src/adapters/outbound/persistence/schema'
import * as reasonCodeMigration from '../../src/adapters/outbound/persistence/migrations/z20261003-hu90-sanction-reason-code'
import { Sanction } from '../../src/domain/entities/Sanction'
import { SanctionReasonCode } from '../../src/domain/entities/SanctionReasonCode'
import { SanctionType } from '../../src/domain/entities/SanctionType'
import { createDatabase, migrateToLatest } from '../../src/infrastructure/persistence/database'
import { startTestPostgres, type TestPostgres } from './postgres-runtime'

const AT = new Date('2026-10-03T10:00:00.000Z')

describe('Código de motivo de sanciones en PostgreSQL (HU-90, CA-05)', () => {
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

  it('persiste el código y lo devuelve en las sanciones activas', async () => {
    await repository.save(
      Sanction.create({
        id: 'suspension-terminos',
        targetAccountId: 'vendedor-db',
        actorAccountId: 'moderador-db',
        type: SanctionType.TemporarySuspension,
        reason: 'Violacion de terminos en subasta.',
        reasonCode: SanctionReasonCode.AuctionTermsViolation,
        createdAt: new Date(AT.getTime() - 60_000),
        expiresAt: new Date(AT.getTime() + 60 * 60_000),
      }),
    )

    const restrictions = await repository.findActiveRestrictions('vendedor-db', AT)

    expect(restrictions).toHaveLength(1)
    expect(restrictions[0]?.toSnapshot()).toMatchObject({
      id: 'suspension-terminos',
      reason: 'Violacion de terminos en subasta.',
      reasonCode: SanctionReasonCode.AuctionTermsViolation,
    })
  })

  it('excluye suspensiones vencidas y advertencias de findActiveRestrictions', async () => {
    await repository.save(
      Sanction.create({
        id: 'vencida',
        targetAccountId: 'vendedor-db',
        actorAccountId: 'moderador-db',
        type: SanctionType.TemporarySuspension,
        reason: 'Vencida.',
        reasonCode: SanctionReasonCode.Other,
        createdAt: new Date(AT.getTime() - 120 * 60_000),
        expiresAt: new Date(AT.getTime() - 60_000),
      }),
    )
    await repository.save(
      Sanction.create({
        id: 'advertencia',
        targetAccountId: 'vendedor-db',
        actorAccountId: 'moderador-db',
        type: SanctionType.Warning,
        reason: 'Aviso.',
        reasonCode: SanctionReasonCode.AuctionTermsViolation,
        createdAt: new Date(AT.getTime() - 60_000),
      }),
    )

    await expect(repository.findActiveRestrictions('vendedor-db', AT)).resolves.toEqual([])
  })

  it('rechaza en el propio motor un código que no pertenece al catálogo', async () => {
    await expect(
      sql`
        insert into sanctions (id, target_account_id, actor_account_id, type, reason, reason_code, created_at)
        values ('codigo-malo', 'vendedor-db', 'moderador-db', 'WARNING', 'Aviso.', 'INVENTADO', now())
      `.execute(db),
    ).rejects.toThrow(/sanctions_codigo_motivo_conocido/)
  })

  it('rechaza en el propio motor una sanción sin código', async () => {
    await expect(
      sql`
        insert into sanctions (id, target_account_id, actor_account_id, type, reason, reason_code, created_at)
        values ('sin-codigo', 'vendedor-db', 'moderador-db', 'WARNING', 'Aviso.', null, now())
      `.execute(db),
    ).rejects.toThrow(/null value|not-null|reason_code/)
  })

  it('la migración asigna OTHER a las sanciones anteriores sin deducirlo del texto libre', async () => {
    await sql`alter table sanctions drop constraint sanctions_codigo_motivo_conocido`.execute(db)
    await sql`alter table sanctions drop column reason_code`.execute(db)
    await sql`
      insert into sanctions (id, target_account_id, actor_account_id, type, reason, created_at)
      values ('historica', 'vendedor-historico', 'moderador-db', 'WARNING',
              'Violacion de terminos en subasta (texto libre).', now())
    `.execute(db)

    await reasonCodeMigration.up(db as Kysely<unknown>)

    const row = await db
      .selectFrom('sanctions')
      .select('reason_code')
      .where('id', '=', 'historica')
      .executeTakeFirstOrThrow()
    expect(row.reason_code).toBe(SanctionReasonCode.Other)

    await sql`delete from sanctions where id = 'historica'`.execute(db)
  })
})
