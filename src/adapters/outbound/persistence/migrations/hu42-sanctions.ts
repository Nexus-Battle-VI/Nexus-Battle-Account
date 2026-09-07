import { sql, type Kysely } from 'kysely'

/**
 * Registro durable de sanciones progresivas de HU-42.
 *
 * Los identificadores del usuario sancionado y del actor se conservan como
 * referencias historicas. No se definen claves foraneas hacia `accounts`
 * porque la evidencia de una sancion debe poder sobrevivir al eventual
 * borrado fisico de una cuenta.
 *
 * HU-42.1 registra advertencias, suspensiones temporales y baneos definitivos.
 * La aplicacion efectiva de restricciones de acceso y la temporalidad de las
 * suspensiones pertenecen a HU-42.2.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createTable('sanctions')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('target_account_id', 'text', (col) => col.notNull())
    .addColumn('actor_account_id', 'text', (col) => col.notNull())
    .addColumn('type', 'text', (col) => col.notNull())
    .addColumn('reason', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      'sanctions_tipo_conocido',
      sql`type in ('WARNING', 'TEMPORARY_SUSPENSION', 'PERMANENT_BAN')`,
    )
    .addCheckConstraint(
      'sanctions_causal_no_vacia',
      sql`length(trim(reason)) > 0`,
    )
    .execute()

  await db.schema
    .createIndex('sanctions_target_account_id_idx')
    .on('sanctions')
    .column('target_account_id')
    .execute()

  await db.schema
    .createIndex('sanctions_actor_account_id_idx')
    .on('sanctions')
    .column('actor_account_id')
    .execute()
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable('sanctions').execute()
}