import type { Kysely } from 'kysely'

import type { SanctionPersistencePort } from '../../../application/ports/SanctionPersistencePort'
import type { Account } from '../../../domain/entities/Account'
import type { Sanction } from '../../../domain/entities/Sanction'
import type { Database } from './schema'

export class PostgresSanctionPersistence implements SanctionPersistencePort {
  constructor(private readonly db: Kysely<Database>) {}

  async saveAppliedSanction(
    sanction: Sanction,
    target: Account,
    accountStatusChanged: boolean,
  ): Promise<void> {
    const snapshot = sanction.toSnapshot()

    await this.db.transaction().execute(async (trx) => {
      if (accountStatusChanged) {
        await trx
          .updateTable('accounts')
          .set({
            status: target.currentStatus,
            updated_at: new Date(),
          })
          .where('id', '=', target.id.value)
          .execute()
      }

      await trx
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
    })
  }
}
