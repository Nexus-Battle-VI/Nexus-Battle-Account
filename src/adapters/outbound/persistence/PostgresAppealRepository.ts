import type { Kysely, Selectable } from 'kysely'

import type { AppealRepositoryPort } from '../../../application/ports/AppealRepositoryPort'
import { Appeal } from '../../../domain/entities/Appeal'
import {
  AppealStatus,
  type AppealStatus as AppealStatusValue,
} from '../../../domain/entities/AppealStatus'
import { isAppealDecision } from '../../../domain/entities/AppealDecision'
import type { AppealsTable, Database } from './schema'

const APPEAL_COLUMNS = [
  'id',
  'sanction_id',
  'account_id',
  'statement',
  'submitted_at',
  'decision_due_at',
  'status',
  'decision',
  'resolution_notes',
  'resolved_by_account_id',
  'resolved_at',
] as const

const isAppealStatus = (value: string): value is AppealStatusValue =>
  value === AppealStatus.Submitted || value === AppealStatus.Resolved

const restoreAppeal = (row: Selectable<AppealsTable>): Appeal => {
  if (!isAppealStatus(row.status)) {
    throw new Error(`Estado de apelacion persistido desconocido: ${row.status}`)
  }

  if (row.decision !== null && !isAppealDecision(row.decision)) {
    throw new Error(`Decision de apelacion persistida desconocida: ${row.decision}`)
  }

  return Appeal.restore({
    id: row.id,
    sanctionId: row.sanction_id,
    accountId: row.account_id,
    statement: row.statement,
    submittedAt: row.submitted_at,
    decisionDueAt: row.decision_due_at,
    status: row.status,
    decision: row.decision,
    resolutionNotes: row.resolution_notes,
    resolvedByAccountId: row.resolved_by_account_id,
    resolvedAt: row.resolved_at,
  })
}

export class PostgresAppealRepository implements AppealRepositoryPort {
  constructor(private readonly db: Kysely<Database>) {}

  async save(appeal: Appeal): Promise<void> {
    const snapshot = appeal.toSnapshot()

    const values = {
      sanction_id: snapshot.sanctionId,
      account_id: snapshot.accountId,
      statement: snapshot.statement,
      submitted_at: snapshot.submittedAt,
      decision_due_at: snapshot.decisionDueAt,
      status: snapshot.status,
      decision: snapshot.decision,
      resolution_notes: snapshot.resolutionNotes,
      resolved_by_account_id: snapshot.resolvedByAccountId,
      resolved_at: snapshot.resolvedAt,
    }

    await this.db
      .insertInto('appeals')
      .values({ id: snapshot.id, ...values })
      .onConflict((oc) => oc.column('id').doUpdateSet(values))
      .execute()
  }

  async saveResolution(appeal: Appeal): Promise<boolean> {
    const snapshot = appeal.toSnapshot()

    const result = await this.db
      .updateTable('appeals')
      .set({
        status: snapshot.status,
        decision: snapshot.decision,
        resolution_notes: snapshot.resolutionNotes,
        resolved_by_account_id: snapshot.resolvedByAccountId,
        resolved_at: snapshot.resolvedAt,
      })
      // La condicion es el punto: solo escribe si SEGUIA en SUBMITTED en
      // la base, no en el momento en que `ResolveAppeal` la leyo. Es lo que
      // impide que dos revisiones concurrentes pisen silenciosamente la
      // decision de la otra.
      .where('id', '=', snapshot.id)
      .where('status', '=', AppealStatus.Submitted)
      .executeTakeFirst()

    return result.numUpdatedRows > 0n
  }

  async findById(id: string): Promise<Appeal | null> {
    const row = await this.db
      .selectFrom('appeals')
      .select([...APPEAL_COLUMNS])
      .where('id', '=', id)
      .executeTakeFirst()

    return row === undefined ? null : restoreAppeal(row)
  }

  async findBySanctionId(sanctionId: string): Promise<Appeal | null> {
    const row = await this.db
      .selectFrom('appeals')
      .select([...APPEAL_COLUMNS])
      .where('sanction_id', '=', sanctionId)
      .executeTakeFirst()

    return row === undefined ? null : restoreAppeal(row)
  }

  async findByAccountId(accountId: string): Promise<readonly Appeal[]> {
    const rows = await this.db
      .selectFrom('appeals')
      .select([...APPEAL_COLUMNS])
      .where('account_id', '=', accountId)
      .orderBy('submitted_at', 'desc')
      .execute()

    return rows.map(restoreAppeal)
  }

  async findPending(): Promise<readonly Appeal[]> {
    const rows = await this.db
      .selectFrom('appeals')
      .select([...APPEAL_COLUMNS])
      .where('status', '=', AppealStatus.Submitted)
      .orderBy('submitted_at', 'asc')
      .execute()

    return rows.map(restoreAppeal)
  }
}
