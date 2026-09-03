import { sql, type Kysely } from 'kysely'

/**
 * Solicitud durable de eliminacion de cuenta (HU-43.1, Task Management #303).
 *
 * `id` lo genera el backend (`IdGeneratorPort`), no es el `token` opaco que
 * Web vaya a manejar en HU-43.2 -esta Task no define ese contrato todavia.
 * `account_id` referencia `accounts` DENTRO del mismo servicio (la
 * prohibicion del proyecto es sobre claves foraneas ENTRE servicios), y NO
 * usa `on delete cascade`: a diferencia de `recovery_challenges` -un proceso
 * transitorio que deja de importar si la cuenta desaparece-, esta fila es la
 * evidencia de que una solicitud de eliminacion existio y cuando se cerro.
 * Que la fila sobreviva o no a un eventual borrado fisico de `accounts` es
 * una decision de HU-43.3 (todavia sin definir), no de esta Task.
 *
 * `status` es texto validado por restriccion, igual que `accounts.status` y
 * `recovery_challenges.stage`: el vocabulario de estados lo fija la base, no
 * solo el codigo.
 *
 * El indice UNICO PARCIAL es la proteccion real contra dos solicitudes
 * activas simultaneas para la misma cuenta (HU-43.1): cubre unicamente las
 * filas cuyo estado no es `CLOSED`, así que una cuenta puede acumular
 * historial de solicitudes cerradas sin que eso choque con la unicidad, pero
 * dos intentos concurrentes de crear una solicitud NUEVA para la misma cuenta
 * -dos `id` distintos- chocan en PostgreSQL, no solo en una comprobacion
 * previa en la aplicacion que una carrera podria saltarse.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createTable('account_deletion_requests')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('account_id', 'text', (col) => col.notNull().references('accounts.id'))
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('received_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('closed_at', 'timestamptz')
    .addCheckConstraint(
      'account_deletion_requests_estado_conocido',
      sql`status in ('RECEIVED', 'IN_PROGRESS', 'FAILED', 'CLOSED')`,
    )
    .execute()

  await sql`
    create unique index account_deletion_requests_una_activa_por_cuenta
      on account_deletion_requests (account_id)
      where status <> 'CLOSED'
  `.execute(db)
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`drop index if exists account_deletion_requests_una_activa_por_cuenta`.execute(db)
  await db.schema.dropTable('account_deletion_requests').execute()
}
