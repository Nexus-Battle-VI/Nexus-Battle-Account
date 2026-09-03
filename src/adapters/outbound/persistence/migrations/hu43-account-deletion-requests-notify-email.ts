import type { Kysely } from 'kysely'

/**
 * Anade el destino de la notificacion de cierre a la solicitud de
 * eliminacion (HU-43.3, Task Management #305).
 *
 * HU-43.1 (migracion `hu43-account-deletion-requests`) no lo necesitaba:
 * todavia no ejecutaba ningun tratamiento ni notificaba nada. HU-43.3 si lo
 * necesita, y no puede leerlo de `accounts.email` en el momento de notificar:
 * el propio tratamiento de HU-43.3 anonimiza ese campo como parte del
 * derecho al olvido, y el proceso debe poder reanudarse tras un reinicio sin
 * depender de un valor que ya fue sobrescrito. Se captura una sola vez, en la
 * recepcion de la solicitud (HU-43.2), igual que `recovery_challenges.email`
 * (HU-04) captura el correo del desafio antes de que nada mas pueda cambiarlo.
 *
 * `NOT NULL` sin valor por defecto es seguro aqui: HU-43.1 se fusiono el
 * mismo dia que esta migracion, sin ningun consumidor todavia creando
 * solicitudes en un entorno con datos reales que hiciera falta migrar hacia
 * atras.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .alterTable('account_deletion_requests')
    .addColumn('notify_email', 'text', (col) => col.notNull())
    .execute()
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.alterTable('account_deletion_requests').dropColumn('notify_email').execute()
}
