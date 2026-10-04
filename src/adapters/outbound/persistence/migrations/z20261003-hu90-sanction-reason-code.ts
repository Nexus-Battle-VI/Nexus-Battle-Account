import { sql, type Kysely } from 'kysely'

/**
 * HU-90 (CA-05): código estructurado del motivo de cada sanción.
 *
 * Las sanciones anteriores reciben OTHER al añadir la columna con DEFAULT, sin
 * deducir ningún código del texto libre `reason`. Después se retira el DEFAULT
 * para que toda sanción nueva declare su código explícitamente.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .alterTable('sanctions')
    .addColumn('reason_code', 'text', (col) => col.notNull().defaultTo('OTHER'))
    .execute()

  await sql`alter table sanctions alter column reason_code drop default`.execute(db)

  await sql`
    alter table sanctions
    add constraint sanctions_codigo_motivo_conocido
    check (reason_code in ('OTHER', 'AUCTION_TERMS_VIOLATION'))
  `.execute(db)
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table sanctions drop constraint sanctions_codigo_motivo_conocido`.execute(db)

  await db.schema.alterTable('sanctions').dropColumn('reason_code').execute()
}
