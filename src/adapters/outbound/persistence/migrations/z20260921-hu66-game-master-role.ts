import { sql, type Kysely } from 'kysely'

/**
 * Incorpora GAME_MASTER al vocabulario persistido para la identidad especial
 * de UPB-COMPANY. No crea ni eleva ninguna cuenta: el aprovisionamiento es un
 * procedimiento controlado fuera de las APIs publicas de Account.
 *
 * El prefijo fechado mantiene esta migracion despues de todas las ya aplicadas
 * en produccion; cambiar una migracion anterior corromperia el historial.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table account_roles drop constraint account_roles_rol_conocido`.execute(db)

  await sql`
    alter table account_roles
      add constraint account_roles_rol_conocido
      check (role in ('PLAYER', 'MODERATOR', 'ADMINISTRATOR', 'SUPER_ADMINISTRATOR', 'GAME_MASTER'))
  `.execute(db)
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table account_roles drop constraint account_roles_rol_conocido`.execute(db)

  await sql`
    alter table account_roles
      add constraint account_roles_rol_conocido
      check (role in ('PLAYER', 'MODERATOR', 'ADMINISTRATOR', 'SUPER_ADMINISTRATOR'))
  `.execute(db)
}
