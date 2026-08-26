import { sql, type Kysely, type Transaction } from 'kysely'

import type { Account } from '../../../domain/entities/Account'
import type { AccountId } from '../../../domain/value-objects/AccountId'
import type { DisplayName } from '../../../domain/value-objects/DisplayName'
import type { EmailAddress } from '../../../domain/value-objects/EmailAddress'
import type {
  AccountRepositoryPort,
  HashedSecurityAnswer,
} from '../../../application/ports/AccountRepositoryPort'
import type { AccountSnapshot } from '../../../domain/entities/Account'
import type { Database } from './schema'
import { toRow, toSnapshot } from './mapping'
import { hydrateAccount } from './hydrate-account'

export class PostgresAccountRepository implements AccountRepositoryPort {
  private readonly db: Kysely<Database>

  constructor(db: Kysely<Database>) {
    this.db = db
  }

  async save(account: Account): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await this.persistAccount(trx, account)
    })
  }

  async saveRegistration(
    account: Account,
    answers: readonly HashedSecurityAnswer[],
  ): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await this.persistAccount(trx, account)

      await trx
        .deleteFrom('account_security_answers')
        .where('account_id', '=', account.id.value)
        .execute()

      if (answers.length > 0) {
        await trx
          .insertInto('account_security_answers')
          .values(
            answers.map((answer) => ({
              account_id: account.id.value,
              question_id: answer.questionId,
              answer_hash: answer.answerHash,
            })),
          )
          .execute()
      }
    })
  }

  async findById(id: AccountId): Promise<Account | null> {
    const row = await this.db
      .selectFrom('accounts')
      .selectAll()
      .where('id', '=', id.value)
      .executeTakeFirst()

    return row === undefined ? null : await this.hydrate(row)
  }

  async findByEmail(email: EmailAddress): Promise<Account | null> {
    const row = await this.db
      .selectFrom('accounts')
      .selectAll()
      .where('email', '=', email.value)
      .executeTakeFirst()

    return row === undefined ? null : await this.hydrate(row)
  }

  async findBySubject(subject: string): Promise<Account | null> {
    const row = await this.db
      .selectFrom('accounts')
      .selectAll()
      .where('subject', '=', subject)
      .executeTakeFirst()

    return row === undefined ? null : await this.hydrate(row)
  }

  async existsByEmail(email: EmailAddress): Promise<boolean> {
    const found = await this.db
      .selectFrom('accounts')
      .select((eb) => eb.lit(1).as('uno'))
      .where('email', '=', email.value)
      .executeTakeFirst()

    return found !== undefined
  }

  async existsByDisplayName(displayName: DisplayName): Promise<boolean> {
    const found = await this.db
      .selectFrom('accounts')
      .select((eb) => eb.lit(1).as('uno'))
      .where(sql`lower(display_name)`, '=', displayName.value.toLowerCase())
      .executeTakeFirst()

    return found !== undefined
  }

  private async persistAccount(trx: Transaction<Database>, account: Account): Promise<void> {
    const snapshot = account.toSnapshot()
    const row = toRow(snapshot)

    await trx
      .insertInto('accounts')
      .values(row)
      .onConflict((oc) =>
        oc.column('id').doUpdateSet({
          subject: row.subject,
          email: row.email,
          display_name: row.display_name,
          first_names: row.first_names,
          last_names: row.last_names,
          terms_accepted: row.terms_accepted,
          avatar_storage_key: row.avatar_storage_key,
          avatar_mime_type: row.avatar_mime_type,
          avatar_size_bytes: row.avatar_size_bytes,
          avatar_original_name: row.avatar_original_name,
          status: row.status,
          updated_at: new Date(),
        }),
      )
      .execute()

    await trx.deleteFrom('account_roles').where('account_id', '=', snapshot.id).execute()

    await trx
      .insertInto('account_roles')
      .values(snapshot.roles.map((role) => ({ account_id: snapshot.id, role })))
      .execute()
  }

  private async hydrate(row: AccountSnapshotRow): Promise<Account> {
    const roles = await this.db
      .selectFrom('account_roles')
      .select('role')
      .where('account_id', '=', row.id)
      .execute()

    const snapshot: AccountSnapshot = toSnapshot(
      row,
      roles.map((entry) => entry.role),
    )

    return hydrateAccount(snapshot)
  }
}

interface AccountSnapshotRow {
  readonly id: string
  readonly subject: string
  readonly email: string
  readonly display_name: string
  readonly first_names: string
  readonly last_names: string
  readonly terms_accepted: boolean
  readonly avatar_storage_key: string
  readonly avatar_mime_type: string
  readonly avatar_size_bytes: number
  readonly avatar_original_name: string
  readonly status: string
}
