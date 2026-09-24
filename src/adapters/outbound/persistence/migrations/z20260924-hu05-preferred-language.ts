import { sql, type Kysely } from 'kysely'

/**
 * Idioma de interfaz elegido por la persona (HU-05, CA-04).
 *
 * Nullable y sin valor por defecto a proposito: `null` significa «nunca eligio»,
 * que no es lo mismo que haber elegido español. Las cuentas existentes quedan en
 * `null` sin backfill, y la imagen anterior del servicio sigue funcionando
 * contra este esquema porque no conoce ni lee la columna.
 *
 * La lista del CHECK es la misma que `PREFERRED_LANGUAGES`: la base de datos es
 * la ultima linea, no la primera.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.alterTable('accounts').addColumn('preferred_language', 'text').execute()
  await db.schema
    .alterTable('accounts')
    .addCheckConstraint(
      'accounts_preferred_language_allowed',
      sql`preferred_language is null or preferred_language in ('es', 'en', 'fr', 'pt')`,
    )
    .execute()
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.alterTable('accounts').dropColumn('preferred_language').execute()
}
