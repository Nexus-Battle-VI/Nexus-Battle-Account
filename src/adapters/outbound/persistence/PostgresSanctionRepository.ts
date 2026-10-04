import type { Kysely, Selectable } from 'kysely'

import type { SanctionRepositoryPort } from '../../../application/ports/SanctionRepositoryPort'
import { Sanction } from '../../../domain/entities/Sanction'
import { isSanctionReasonCode } from '../../../domain/entities/SanctionReasonCode'
import { SanctionType, isSanctionType } from '../../../domain/entities/SanctionType'
import type { Database, SanctionsTable } from './schema'

const SANCTION_COLUMNS = [
  'id',
  'target_account_id',
  'actor_account_id',
  'type',
  'reason',
  'reason_code',
  'created_at',
  'expires_at',
] as const

const restoreSanction = (row: Selectable<SanctionsTable>): Sanction => {
  if (!isSanctionType(row.type)) {
    throw new Error(`Tipo de sancion persistido desconocido: ${row.type}`)
  }

  if (!isSanctionReasonCode(row.reason_code)) {
    throw new Error(`Codigo de motivo de sancion persistido desconocido: ${row.reason_code}`)
  }

  return Sanction.restore({
    id: row.id,
    targetAccountId: row.target_account_id,
    actorAccountId: row.actor_account_id,
    type: row.type,
    reason: row.reason,
    reasonCode: row.reason_code,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  })
}

export class PostgresSanctionRepository implements SanctionRepositoryPort {
  constructor(private readonly db: Kysely<Database>) {}

  async findAccountIdsWithHistory(accountIds: readonly string[]): Promise<readonly string[]> {
    if (accountIds.length === 0) return []
    const rows = await this.db
      .selectFrom('sanctions')
      .select('target_account_id')
      .distinct()
      .where('target_account_id', 'in', accountIds)
      .execute()
    return rows.map((row) => row.target_account_id)
  }

  async save(sanction: Sanction): Promise<void> {
    const snapshot = sanction.toSnapshot()

    await this.db
      .insertInto('sanctions')
      .values({
        id: snapshot.id,
        target_account_id: snapshot.targetAccountId,
        actor_account_id: snapshot.actorAccountId,
        type: snapshot.type,
        reason: snapshot.reason,
        reason_code: snapshot.reasonCode,
        created_at: snapshot.createdAt,
        expires_at: snapshot.expiresAt,
      })
      .execute()
  }

  async findActiveRestrictions(targetAccountId: string, at: Date): Promise<readonly Sanction[]> {
    const rows = await this.db
      .selectFrom('sanctions')
      .select([...SANCTION_COLUMNS])
      .where('target_account_id', '=', targetAccountId)
      .where((eb) =>
        eb.or([
          eb('type', '=', SanctionType.PermanentBan),
          eb.and([eb('type', '=', SanctionType.TemporarySuspension), eb('expires_at', '>', at)]),
        ]),
      )
      .orderBy('created_at', 'desc')
      .execute()

    return rows.map(restoreSanction)
  }

  async findActiveTemporarySuspension(targetAccountId: string, at: Date): Promise<Sanction | null> {
    const row = await this.db
      .selectFrom('sanctions')
      .select([...SANCTION_COLUMNS])
      .where('target_account_id', '=', targetAccountId)
      .where('type', '=', SanctionType.TemporarySuspension)
      .where('expires_at', '>', at)
      .orderBy('expires_at', 'desc')
      .executeTakeFirst()

    return row === undefined ? null : restoreSanction(row)
  }

  async findLatestTemporarySuspension(targetAccountId: string): Promise<Sanction | null> {
    const row = await this.db
      .selectFrom('sanctions')
      .select([...SANCTION_COLUMNS])
      .where('target_account_id', '=', targetAccountId)
      .where('type', '=', SanctionType.TemporarySuspension)
      .orderBy('created_at', 'desc')
      .executeTakeFirst()

    return row === undefined ? null : restoreSanction(row)
  }
}
