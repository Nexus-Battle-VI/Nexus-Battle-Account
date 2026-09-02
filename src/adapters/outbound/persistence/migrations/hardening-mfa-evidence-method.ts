import { sql, type Kysely } from 'kysely'

/**
 * Conserva el metodo real que origino cada evidencia MFA.
 *
 * Las filas anteriores no se pueden clasificar de forma honesta: Account
 * admitia aplicacion autenticadora, SMS y correo, pero descartaba ese dato.
 * Se eliminan antes de exigir la columna; son pruebas efimeras ligadas a tokens
 * de acceso, y obligar a repetir MFA es mas seguro que etiquetarlas como TOTP.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.alterTable('mfa_evidences').addColumn('method', 'varchar(32)').execute()

  await sql`delete from mfa_evidences`.execute(db)

  await db.schema
    .alterTable('mfa_evidences')
    .alterColumn('method', (col) => col.setNotNull())
    .execute()

  await db.schema
    .alterTable('mfa_evidences')
    .addCheckConstraint(
      'mfa_evidences_method_check',
      sql`method in ('AUTHENTICATOR_APP', 'EMAIL', 'SMS')`,
    )
    .execute()
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.alterTable('mfa_evidences').dropColumn('method').execute()
}
