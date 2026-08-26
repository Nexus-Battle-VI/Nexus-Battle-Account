import { sql, type Kysely } from 'kysely'

/**
 * Esquema inicial de Account.
 *
 * Las migraciones son TypeScript revisable en un PR, que es una de las razones
 * por las que ADR-012 eligio Kysely: el esquema cambia por el mismo camino que
 * el codigo, no por un fichero generado que nadie lee.
 *
 * `up` y `down` reciben `Kysely<unknown>` a proposito: una migracion NO debe
 * tipar contra el esquema actual. Si lo hiciera, dejaria de compilar en cuanto
 * una migracion posterior cambiara una tabla, y una migracion antigua tiene que
 * seguir siendo ejecutable tal y como se escribio.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createTable('accounts')
    .addColumn('id', 'text', (col) => col.primaryKey())
    // Unico: dos cuentas con el mismo sujeto harian ambigua la pregunta
    // "cual es MI cuenta".
    .addColumn('subject', 'text', (col) => col.notNull().unique())
    // El dominio ya normaliza a minusculas en `EmailAddress`. La restriccion
    // aqui es la ultima linea, no la primera.
    .addColumn('email', 'text', (col) => col.notNull().unique())
    .addColumn('display_name', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint(
      'accounts_status_conocido',
      sql`status in ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED')`,
    )
    .execute()

  await db.schema
    .createTable('account_roles')
    .addColumn('account_id', 'text', (col) =>
      // Clave foranea DENTRO del mismo servicio. La prohibicion del proyecto es
      // sobre claves foraneas entre servicios.
      col.notNull().references('accounts.id').onDelete('cascade'),
    )
    .addColumn('role', 'text', (col) => col.notNull())
    .addPrimaryKeyConstraint('account_roles_pk', ['account_id', 'role'])
    // El vocabulario de roles se valida en la base de datos, no solo en el
    // codigo: un rol inventado no llega a escribirse.
    .addCheckConstraint(
      'account_roles_rol_conocido',
      sql`role in ('PLAYER', 'MODERATOR', 'ADMINISTRATOR')`,
    )
    .execute()
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  // En orden inverso: `account_roles` referencia a `accounts`.
  await db.schema.dropTable('account_roles').execute()
  await db.schema.dropTable('accounts').execute()
}
