import { sql, type Kysely, type Transaction } from 'kysely'

import type { Account } from '../../../domain/entities/Account'
import type { AccountId } from '../../../domain/value-objects/AccountId'
import type { DisplayName } from '../../../domain/value-objects/DisplayName'
import type { EmailAddress } from '../../../domain/value-objects/EmailAddress'
import type {
  AccountRepositoryPort,
  HashedSecurityAnswer,
} from '../../../application/ports/AccountRepositoryPort'
import type { AdminAccountQueryPort } from '../../../application/ports/AdminAccountQueryPort'
import type { AdminAccountQueryCriteria } from '../../../application/dto/AdminAccountQueryCriteria'
import {
  orderAdminAccountRoles,
  type AdminAccountSummaryDto,
} from '../../../application/dto/AdminAccountSummaryDto'
import type { AccountSnapshot } from '../../../domain/entities/Account'
import { AccountStatus } from '../../../domain/entities/AccountStatus'
import { isRole, type Role } from '../../../domain/entities/Role'
import type { Database } from './schema'
import { PersistenceMappingError, toRow, toSnapshot } from './mapping'
import { hydrateAccount } from './hydrate-account'

export class PostgresAccountRepository implements AccountRepositoryPort, AdminAccountQueryPort {
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

  async findByDisplayName(displayName: DisplayName): Promise<Account | null> {
    const row = await this.db
      .selectFrom('accounts')
      .selectAll()
      .where(sql`lower(display_name)`, '=', displayName.value.toLowerCase())
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

  async deleteById(id: AccountId): Promise<void> {
    // `account_roles` y `account_security_answers` referencian `accounts` con
    // `on delete cascade`: no hace falta borrarlas aqui aparte. Borrar un id
    // que ya no existe afecta cero filas, no lanza.
    await this.db.deleteFrom('accounts').where('id', '=', id.value).execute()
  }

  async findSecurityAnswers(id: AccountId): Promise<readonly HashedSecurityAnswer[]> {
    const rows = await this.db
      .selectFrom('account_security_answers')
      .select(['question_id', 'answer_hash'])
      .where('account_id', '=', id.value)
      .execute()

    return rows.map((row) => ({
      questionId: row.question_id,
      answerHash: row.answer_hash,
    }))
  }

  async existsByDisplayName(displayName: DisplayName): Promise<boolean> {
    const found = await this.db
      .selectFrom('accounts')
      .select((eb) => eb.lit(1).as('uno'))
      .where(sql`lower(display_name)`, '=', displayName.value.toLowerCase())
      .executeTakeFirst()

    return found !== undefined
  }

  async query(criteria: AdminAccountQueryCriteria): Promise<readonly AdminAccountSummaryDto[]> {
    let query = this.db
      .selectFrom('accounts as account')
      .select([
        'account.id as id',
        'account.email as email',
        'account.display_name as display_name',
        'account.first_names as first_names',
        'account.last_names as last_names',
        'account.status as status',
        'account.created_at as created_at',
      ])

    if (criteria.id !== undefined) {
      query = query.where('account.id', '=', criteria.id)
    }

    if (criteria.email !== undefined) {
      query = query.where('account.email', '=', criteria.email)
    }

    if (criteria.firstNames !== undefined) {
      query = query.where(sql`lower(account.first_names)`, '=', criteria.firstNames.toLowerCase())
    }

    if (criteria.lastNames !== undefined) {
      query = query.where(sql`lower(account.last_names)`, '=', criteria.lastNames.toLowerCase())
    }

    if (criteria.displayName !== undefined) {
      query = query.where(sql`lower(account.display_name)`, '=', criteria.displayName.toLowerCase())
    }

    if (criteria.status !== undefined) {
      query = query.where('account.status', '=', criteria.status)
    }

    if (criteria.role !== undefined) {
      const role = criteria.role
      query = query.where((eb) =>
        eb.exists(
          eb
            .selectFrom('account_roles as role')
            .select('role.account_id')
            .whereRef('role.account_id', '=', 'account.id')
            .where('role.role', '=', role),
        ),
      )
    }

    const rows = await query.orderBy('account.id', 'asc').execute()

    if (rows.length === 0) {
      return []
    }

    const roles = await this.db
      .selectFrom('account_roles')
      .select(['account_id', 'role'])
      .where(
        'account_id',
        'in',
        rows.map((row) => row.id),
      )
      .execute()

    const rolesByAccount = new Map<string, Role[]>()

    for (const entry of roles) {
      if (!isRole(entry.role)) {
        throw new PersistenceMappingError(
          `La cuenta ${entry.account_id} tiene un rol desconocido: "${entry.role}".`,
        )
      }

      rolesByAccount.set(entry.account_id, [
        ...(rolesByAccount.get(entry.account_id) ?? []),
        entry.role,
      ])
    }

    return rows.map((row) => {
      const status = knownStatus(row)
      const accountRoles = rolesByAccount.get(row.id) ?? []

      if (accountRoles.length === 0) {
        throw new PersistenceMappingError(`La cuenta ${row.id} no tiene ningun rol almacenado.`)
      }

      return {
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        firstNames: row.first_names,
        lastNames: row.last_names,
        status,
        roles: orderAdminAccountRoles(accountRoles),
        registeredAt: row.created_at.toISOString(),
      }
    })
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

interface AdminAccountRow {
  readonly id: string
  readonly email: string
  readonly display_name: string
  readonly first_names: string
  readonly last_names: string
  readonly status: string
  readonly created_at: Date
}

const ACCOUNT_STATUSES: readonly string[] = Object.values(AccountStatus)

const knownStatus = (row: AdminAccountRow): AccountStatus => {
  if (!ACCOUNT_STATUSES.includes(row.status)) {
    throw new PersistenceMappingError(
      `La cuenta ${row.id} tiene un estado desconocido: "${row.status}".`,
    )
  }

  return row.status as AccountStatus
}
