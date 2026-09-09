import type { Kysely } from 'kysely'

import type { SanctionRepositoryPort } from '../../../application/ports/SanctionRepositoryPort'
import type { Sanction } from '../../../domain/entities/Sanction'
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
      })
      .execute()
  }
}
