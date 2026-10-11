import { sql, type Kysely } from 'kysely'

/**
 * Apelaciones de sanciones (HU-42, §7.3.2 "Proceso de apelacion").
 *
 * Una sancion tiene a lo sumo una apelacion: `sanction_id` es UNIQUE, no solo
 * indexado, para que la restriccion viva en la base y no solo en el caso de
 * uso. Sin clave foranea hacia `sanctions`/`accounts`, mismo criterio que esa
 * migracion: la evidencia de una apelacion debe sobrevivir a un eventual
 * borrado fisico de la cuenta o, en teoria, de la sancion.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createTable('appeals')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('sanction_id', 'text', (col) => col.notNull().unique())
    .addColumn('account_id', 'text', (col) => col.notNull())
    .addColumn('statement', 'text', (col) => col.notNull())
    .addColumn('submitted_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('decision_due_at', 'timestamptz', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('decision', 'text')
    .addColumn('resolution_notes', 'text')
    .addColumn('resolved_by_account_id', 'text')
    .addColumn('resolved_at', 'timestamptz')
    .addCheckConstraint('appeals_estado_conocido', sql`status in ('SUBMITTED', 'RESOLVED')`)
    .addCheckConstraint(
      'appeals_decision_conocida',
      sql`decision is null or decision in ('UPHELD', 'OVERTURNED')`,
    )
    .addCheckConstraint('appeals_justificacion_no_vacia', sql`length(trim(statement)) > 0`)
    .addCheckConstraint(
      'appeals_resolucion_consistente',
      sql`
        (status = 'SUBMITTED' and decision is null and resolved_at is null and resolved_by_account_id is null)
        or
        (status = 'RESOLVED' and decision is not null and resolved_at is not null and resolved_by_account_id is not null)
      `,
    )
    .execute()

  await db.schema.createIndex('appeals_account_id_idx').on('appeals').column('account_id').execute()
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable('appeals').execute()
}
