import { sql, type Kysely } from 'kysely'

/** Optional self-declared profile country; old accounts remain unknown. */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.alterTable('accounts').addColumn('country_code', 'text').execute()
  await db.schema
    .alterTable('accounts')
    .addCheckConstraint(
      'accounts_country_code_format',
      sql`country_code is null or country_code ~ '^[A-Z]{2}$'`,
    )
    .execute()
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.alterTable('accounts').dropColumn('country_code').execute()
}
