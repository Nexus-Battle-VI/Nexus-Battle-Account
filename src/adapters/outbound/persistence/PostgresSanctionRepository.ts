import type { Kysely } from 'kysely'

import type { SanctionRepositoryPort } from '../../../application/ports/SanctionRepositoryPort'
import { Sanction } from '../../../domain/entities/Sanction'
import { SanctionType } from '../../../domain/entities/SanctionType'
import type { Database } from './schema'

export class PostgresSanctionRepository implements SanctionRepositoryPort {
  constructor(private readonly db: Kysely<Database>) {}

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
        created_at: snapshot.createdAt,
        expires_at: snapshot.expiresAt,
      })
      .execute()
  }

  async findActiveTemporarySuspension(targetAccountId: string, at: Date): Promise<Sanction | null> {
    const row = await this.db
      .selectFrom('sanctions')
      .select([
        'id',
        'target_account_id',
        'actor_account_id',
        'type',
        'reason',
        'created_at',
        'expires_at',
      ])
      .where('target_account_id', '=', targetAccountId)
      .where('type', '=', SanctionType.TemporarySuspension)
      .where('expires_at', '>', at)
      .orderBy('expires_at', 'desc')
      .executeTakeFirst()

    if (row === undefined) {
      return null
    }

    return Sanction.restore({
      id: row.id,
      targetAccountId: row.target_account_id,
      actorAccountId: row.actor_account_id,
      type: SanctionType.TemporarySuspension,
      reason: row.reason,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    })
  }

  async findLatestTemporarySuspension(targetAccountId: string): Promise<Sanction | null> {
    const row = await this.db
      .selectFrom('sanctions')
      .select([
        'id',
        'target_account_id',
        'actor_account_id',
        'type',
        'reason',
        'created_at',
        'expires_at',
      ])
      .where('target_account_id', '=', targetAccountId)
      .where('type', '=', SanctionType.TemporarySuspension)
      .orderBy('created_at', 'desc')
      .executeTakeFirst()

    if (row === undefined) {
      return null
    }

    return Sanction.restore({
      id: row.id,
      targetAccountId: row.target_account_id,
      actorAccountId: row.actor_account_id,
      type: SanctionType.TemporarySuspension,
      reason: row.reason,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    })
  }
}
