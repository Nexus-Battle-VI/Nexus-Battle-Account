import 'reflect-metadata'

import { sql, type Kysely } from 'kysely'

import { PostgresAppealRepository } from '../../src/adapters/outbound/persistence/PostgresAppealRepository'
import type { Database } from '../../src/adapters/outbound/persistence/schema'
import { Appeal } from '../../src/domain/entities/Appeal'
import { AppealStatus } from '../../src/domain/entities/AppealStatus'
import { AppealDecision } from '../../src/domain/entities/AppealDecision'
import { createDatabase, migrateToLatest } from '../../src/infrastructure/persistence/database'
import { startTestPostgres, type TestPostgres } from './postgres-runtime'

const SUBMITTED_AT = new Date('2026-10-05T12:00:00.000Z')

const submit = (params: { id: string; sanctionId: string; accountId: string }): Appeal =>
  Appeal.submit({
    id: params.id,
    sanctionId: params.sanctionId,
    accountId: params.accountId,
    statement: 'Justificacion de prueba.',
    submittedAt: SUBMITTED_AT,
  })

describe('Apelaciones en PostgreSQL (HU-42, §7.3.2)', () => {
  let container: TestPostgres
  let db: Kysely<Database>
  let repository: PostgresAppealRepository

  beforeAll(async () => {
    container = await startTestPostgres()
    db = createDatabase({ connectionString: container.getConnectionUri(), maxConnections: 2 })
    const outcome = await migrateToLatest(db)
    expect(outcome.error).toBeUndefined()
    repository = new PostgresAppealRepository(db)
  })

  afterAll(async () => {
    await db.destroy()
    await container.stop()
  })

  beforeEach(async () => {
    await db.deleteFrom('appeals').execute()
  })

  it('persiste y recupera una apelacion SUBMITTED', async () => {
    const appeal = submit({ id: 'appeal-1', sanctionId: 'sancion-1', accountId: 'cuenta-1' })
    await repository.save(appeal)

    const found = await repository.findById('appeal-1')
    expect(found?.toSnapshot()).toMatchObject({
      id: 'appeal-1',
      sanctionId: 'sancion-1',
      accountId: 'cuenta-1',
      status: AppealStatus.Submitted,
      decision: null,
    })
  })

  it('findBySanctionId encuentra la apelacion de esa sancion', async () => {
    await repository.save(submit({ id: 'appeal-2', sanctionId: 'sancion-2', accountId: 'cuenta-1' }))

    const found = await repository.findBySanctionId('sancion-2')
    expect(found?.id).toBe('appeal-2')
    expect(await repository.findBySanctionId('sancion-inexistente')).toBeNull()
  })

  it('findByAccountId devuelve mas recientes primero', async () => {
    const older = submit({ id: 'appeal-older', sanctionId: 'sancion-older', accountId: 'cuenta-2' })
    await repository.save(older)

    const newer = Appeal.submit({
      id: 'appeal-newer',
      sanctionId: 'sancion-newer',
      accountId: 'cuenta-2',
      statement: 'Mas reciente.',
      submittedAt: new Date(SUBMITTED_AT.getTime() + 60_000),
    })
    await repository.save(newer)

    const found = await repository.findByAccountId('cuenta-2')
    expect(found.map((a) => a.id)).toEqual(['appeal-newer', 'appeal-older'])
  })

  it('findPending solo devuelve apelaciones SUBMITTED, en orden de llegada', async () => {
    const appeal = submit({ id: 'appeal-pending', sanctionId: 'sancion-pending', accountId: 'cuenta-3' })
    await repository.save(appeal)

    const resolved = submit({ id: 'appeal-resolved', sanctionId: 'sancion-resolved', accountId: 'cuenta-3' })
    resolved.resolve({
      decision: AppealDecision.Upheld,
      notes: 'Resuelta.',
      resolvedByAccountId: 'admin-1',
      resolvedAt: new Date('2026-10-06T12:00:00.000Z'),
    })
    await repository.save(resolved)

    const pending = await repository.findPending()
    expect(pending.map((a) => a.id)).toEqual(['appeal-pending'])
  })

  it('persiste una resolucion y la recupera con decision y auditoria completas', async () => {
    const appeal = submit({ id: 'appeal-resolve-roundtrip', sanctionId: 'sancion-rt', accountId: 'cuenta-4' })
    await repository.save(appeal)

    appeal.resolve({
      decision: AppealDecision.Overturned,
      notes: 'La evidencia desvirtua la causal.',
      resolvedByAccountId: 'admin-2',
      resolvedAt: new Date('2026-10-07T09:00:00.000Z'),
    })
    await repository.save(appeal)

    const found = await repository.findById('appeal-resolve-roundtrip')
    expect(found?.toSnapshot()).toMatchObject({
      status: AppealStatus.Resolved,
      decision: AppealDecision.Overturned,
      resolutionNotes: 'La evidencia desvirtua la causal.',
      resolvedByAccountId: 'admin-2',
    })
  })

  it('rechaza en el propio motor una segunda apelacion para la misma sancion', async () => {
    await repository.save(submit({ id: 'appeal-unique-1', sanctionId: 'sancion-unica', accountId: 'cuenta-5' }))

    await expect(
      repository.save(
        submit({ id: 'appeal-unique-2', sanctionId: 'sancion-unica', accountId: 'cuenta-5' }),
      ),
    ).rejects.toThrow()
  })

  it('rechaza en el propio motor un estado desconocido', async () => {
    await expect(
      sql`
        insert into appeals (id, sanction_id, account_id, statement, decision_due_at, status)
        values ('estado-malo', 'sancion-x', 'cuenta-x', 'Justificacion.', now(), 'INVENTADO')
      `.execute(db),
    ).rejects.toThrow(/appeals_estado_conocido/)
  })

  it('rechaza en el propio motor una apelacion SUBMITTED con decision ya puesta', async () => {
    await expect(
      sql`
        insert into appeals (id, sanction_id, account_id, statement, decision_due_at, status, decision)
        values ('inconsistente', 'sancion-y', 'cuenta-y', 'Justificacion.', now(), 'SUBMITTED', 'UPHELD')
      `.execute(db),
    ).rejects.toThrow(/appeals_resolucion_consistente/)
  })

  it('rechaza en el propio motor una justificacion vacia', async () => {
    await expect(
      sql`
        insert into appeals (id, sanction_id, account_id, statement, decision_due_at, status)
        values ('sin-justificacion', 'sancion-z', 'cuenta-z', '   ', now(), 'SUBMITTED')
      `.execute(db),
    ).rejects.toThrow(/appeals_justificacion_no_vacia/)
  })
})
