import { sql, type Kysely } from 'kysely'

/**
 * Proceso temporal de recuperacion de contrasena (HU-04, TASK HU-04.2).
 *
 * `token` es la clave primaria: es el identificador opaco que Web ya maneja
 * como `challengeToken`, no hace falta un `id` interno aparte. `account_id`
 * referencia `accounts` DENTRO del mismo servicio (la prohibicion del
 * proyecto es sobre claves foraneas entre servicios) pero es nullable: el
 * desafio se crea exista o no la cuenta, para no permitir enumerar correos
 * registrados desde la respuesta del primer paso. `code_hash` tambien es
 * nullable: nace `null` en `IDENTIFIED` y el codigo en claro nunca se
 * persiste, solo su resumen.
 *
 * Sin restriccion de unicidad sobre `email`: nada impide que la misma cuenta
 * tenga varios desafios abiertos (por ejemplo, si abandona uno y reintenta).
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createTable('recovery_challenges')
    .addColumn('token', 'text', (col) => col.primaryKey())
    .addColumn('email', 'text', (col) => col.notNull())
    .addColumn('account_id', 'text', (col) => col.references('accounts.id').onDelete('cascade'))
    .addColumn('stage', 'text', (col) => col.notNull())
    .addColumn('code_hash', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint(
      'recovery_challenges_stage_conocido',
      sql`stage in ('IDENTIFIED', 'QUESTIONS_VERIFIED', 'CODE_VERIFIED', 'COMPLETED')`,
    )
    .execute()
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable('recovery_challenges').execute()
}
