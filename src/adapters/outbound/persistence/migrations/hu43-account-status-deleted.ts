import { sql, type Kysely } from 'kysely'

/**
 * Incorpora DELETED al vocabulario de `accounts.status` (HU-43.3, Task
 * Management #305).
 *
 * Mismo patron que `hu03-super-administrator-role`: ALTER de la restriccion
 * existente (drop + add), no recreacion de la tabla, y las migraciones ya
 * aplicadas (`001-accounts`) permanecen intactas. Sin esta migracion,
 * `Account.erase()` seguido de `save()` violaria
 * `accounts_status_conocido` en un motor real -el propio test
 * `persistence-mapping.spec.ts` que compara el vocabulario del dominio
 * contra el SQL de las migraciones lo detecto antes que cualquier prueba
 * contra PostgreSQL real-.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table accounts drop constraint accounts_status_conocido`.execute(db)

  await sql`
    alter table accounts
      add constraint accounts_status_conocido
      check (status in ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DELETED'))
  `.execute(db)
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table accounts drop constraint accounts_status_conocido`.execute(db)

  await sql`
    alter table accounts
      add constraint accounts_status_conocido
      check (status in ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED'))
  `.execute(db)
}
