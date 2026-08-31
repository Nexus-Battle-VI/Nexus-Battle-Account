import type { Kysely } from 'kysely'

import { RecoveryChallenge, type RecoveryStage } from '../../../domain/entities/RecoveryChallenge'
import type { RecoveryChallengeRepositoryPort } from '../../../application/ports/RecoveryChallengeRepositoryPort'
import type { Database } from './schema'

export class PostgresRecoveryChallengeRepository implements RecoveryChallengeRepositoryPort {
  private readonly db: Kysely<Database>

  constructor(db: Kysely<Database>) {
    this.db = db
  }

  async save(challenge: RecoveryChallenge): Promise<void> {
    const snapshot = challenge.toSnapshot()

    await this.db
      .insertInto('recovery_challenges')
      .values({
        token: snapshot.token,
        email: snapshot.email,
        account_id: snapshot.accountId,
        stage: snapshot.stage,
        code_hash: snapshot.codeHash,
      })
      .onConflict((oc) =>
        oc.column('token').doUpdateSet({
          stage: snapshot.stage,
          code_hash: snapshot.codeHash,
        }),
      )
      .execute()
  }

  async findByToken(token: string): Promise<RecoveryChallenge | null> {
    const row = await this.db
      .selectFrom('recovery_challenges')
      .selectAll()
      .where('token', '=', token)
      .executeTakeFirst()

    if (row === undefined) {
      return null
    }

    return RecoveryChallenge.restore({
      token: row.token,
      email: row.email,
      accountId: row.account_id,
      stage: row.stage as RecoveryStage,
      codeHash: row.code_hash,
      createdAt: row.created_at.toISOString(),
    })
  }
}
