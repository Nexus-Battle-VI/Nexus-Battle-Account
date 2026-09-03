import { sql, type Kysely } from 'kysely'

/**
 * Desacopla `account_deletion_requests.account_id` de `accounts` (HU-43.3,
 * Management Task #305).
 *
 * La migracion de HU-43.1 (`hu43-account-deletion-requests`) dejo esta
 * decision explicitamente pendiente: "Que la fila sobreviva o no a un
 * eventual borrado fisico de `accounts` es una decision de HU-43.3, no de
 * esta Task". HU-43.3 la resuelve: el tratamiento de HU-43 elimina
 * fisicamente la fila de `accounts` (`AccountRepositoryPort.deleteById`), y
 * `account_deletion_requests` es la evidencia de que esa solicitud existio y
 * cuando se cerro -debe sobrevivir a esa eliminacion, no desaparecer con ella
 * ni impedirla.
 *
 * Una restriccion `foreign key` sin `on delete` es `NO ACTION` por defecto:
 * PostgreSQL RECHAZARIA el `DELETE` de `accounts` mientras exista una fila de
 * `account_deletion_requests` que la referencie -exactamente la fila que el
 * propio tratamiento necesita conservar tras cerrar la solicitud-. Ni
 * `on delete cascade` (borraria la evidencia junto con la cuenta) ni
 * `on delete set null` (la columna es `not null`: es evidencia, no un dato
 * opcional) resuelven esto sin perder lo que la fila debe demostrar. Se
 * retira la restriccion de clave foranea: `account_id` sigue siendo el
 * identificador que tuvo la cuenta, pero deja de exigir que esa cuenta siga
 * existiendo.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    alter table account_deletion_requests
      drop constraint account_deletion_requests_account_id_fkey
  `.execute(db)
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    alter table account_deletion_requests
      add constraint account_deletion_requests_account_id_fkey
      foreign key (account_id) references accounts (id)
  `.execute(db)
}
