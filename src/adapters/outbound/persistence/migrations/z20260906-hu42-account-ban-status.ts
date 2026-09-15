import { sql, type Kysely } from 'kysely'

/**
 * HU-42.2
 *
 * Amplia los estados permitidos de una cuenta para soportar el baneo
 * permanente sin modificar la migracion historica 001-accounts.
 *
 * El prefijo temporal mantiene esta migracion al final del historial ya
 * aplicado. El proveedor de migraciones de este servicio exige orden
 * alfabetico estable.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    alter table accounts
    drop constraint accounts_status_conocido
  `.execute(db)

  await sql`
    alter table accounts
    add constraint accounts_status_conocido
    check (
      status in (
        'PENDING_VERIFICATION',
        'ACTIVE',
        'SUSPENDED',
        'BANNED'
      )
    )
  `.execute(db)
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    alter table accounts
    drop constraint accounts_status_conocido
  `.execute(db)

  await sql`
    alter table accounts
    add constraint accounts_status_conocido
    check (
      status in (
        'PENDING_VERIFICATION',
        'ACTIVE',
        'SUSPENDED'
      )
    )
  `.execute(db)
}
