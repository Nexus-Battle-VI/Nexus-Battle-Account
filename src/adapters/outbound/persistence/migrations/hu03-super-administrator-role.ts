import { sql, type Kysely } from 'kysely'

/**
 * Incorpora SUPER_ADMINISTRATOR al vocabulario de roles de `account_roles`
 * (HU-02 — inicio de sesion y RBAC).
 *
 * El nombre del archivo sigue el orden SECUENCIAL de migraciones de este
 * servicio (`hu01-registration` -> `hu02-nickname-blacklist-seed` -> esta es
 * la tercera), no el numero de la historia de usuario: `hu02-nickname-blacklist-seed`
 * ya ocupaba el prefijo `hu02` y no tiene relacion con HU-02. Kysely ordena
 * las migraciones alfabeticamente por nombre, así que el prefijo solo fija el
 * orden de aplicacion.
 *
 * No toca `001-accounts`, `hu01-registration` ni `hu02-nickname-blacklist-seed`:
 * son migraciones ya aplicadas y una migracion vieja debe seguir siendo
 * ejecutable tal y como se escribio. Se elige ALTER de la restriccion
 * existente (drop + add) en lugar de recrear la tabla: es el cambio minimo
 * sobre el esquema ya aprobado en HU-01.
 *
 * No crea filas ni cuentas: HU-02 solo LEE el rol vigente, no lo asigna. Un
 * Super Administrador de prueba se construye en los tests directamente con
 * `Account.restore(...)`, sin pasar por ningun endpoint publico (HU-10 del
 * reporte de HU-02).
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table account_roles drop constraint account_roles_rol_conocido`.execute(db)

  await sql`
    alter table account_roles
      add constraint account_roles_rol_conocido
      check (role in ('PLAYER', 'MODERATOR', 'ADMINISTRATOR', 'SUPER_ADMINISTRATOR'))
  `.execute(db)
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table account_roles drop constraint account_roles_rol_conocido`.execute(db)

  await sql`
    alter table account_roles
      add constraint account_roles_rol_conocido
      check (role in ('PLAYER', 'MODERATOR', 'ADMINISTRATOR'))
  `.execute(db)
}
