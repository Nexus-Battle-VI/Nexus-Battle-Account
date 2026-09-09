import type { Kysely } from 'kysely'

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.alterTable('sanctions').addColumn('expires_at', 'timestamptz').execute()
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.alterTable('sanctions').dropColumn('expires_at').execute()
}
