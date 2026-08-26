import { sql, type Kysely } from 'kysely'

import { NICKNAME_BLACKLIST_SEED } from '../nickname-blacklist-seed'

/**
 * Semilla inicial de la lista negra de apodos.
 *
 * El nombre va despues de `hu01-registration` en orden alfabetico: Kysely
 * exige que toda migracion nueva quede detras de las ya aplicadas.
 * Los terminos se pueden desactivar despues con `active = false`.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  for (const entry of NICKNAME_BLACKLIST_SEED) {
    await sql`
      insert into nickname_blacklist_entries (id, term, active)
      values (${entry.id}, ${entry.term}, true)
      on conflict (id) do nothing
    `.execute(db)
  }
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  for (const entry of NICKNAME_BLACKLIST_SEED) {
    await sql`
      delete from nickname_blacklist_entries where id = ${entry.id}
    `.execute(db)
  }
}
