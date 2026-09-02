import { sql, type Kysely } from 'kysely'

/**
 * Evidencia de segundo factor por testimonio de acceso.
 *
 * La clave primaria es COMPUESTA por `(subject, jti)` y no un identificador
 * propio: es exactamente la pregunta que responde la tabla —«¿este sujeto
 * supero el segundo factor para ESTE testimonio?»— y la clave compuesta impide
 * por construccion que existan dos respuestas distintas para la misma pregunta.
 *
 * NO hay clave foranea hacia `accounts`. La evidencia se indexa por el `sub`
 * del proveedor de identidad, no por el identificador interno de la cuenta;
 * son valores distintos y confundirlos ya causo problemas en este servicio.
 *
 * `expires_at` se copia del `exp` del testimonio verificado, nunca de una
 * constante: la vigencia de la evidencia no debe sobrevivir al testimonio que
 * describe.
 *
 * El indice sobre `expires_at` sostiene la consulta de validez, que siempre
 * filtra por vigencia, y permite ademas retirar filas vencidas en lote si algun
 * dia hiciera falta. No se anade proceso de limpieza: una fila caducada deja de
 * responder que si en el mismo instante en que expira, porque el filtro va en
 * la consulta.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createTable('mfa_evidences')
    .addColumn('subject', 'text', (col) => col.notNull())
    .addColumn('jti', 'text', (col) => col.notNull())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('verified_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('mfa_evidences_pkey', ['subject', 'jti'])
    .execute()

  await db.schema
    .createIndex('mfa_evidences_expires_at_idx')
    .on('mfa_evidences')
    .column('expires_at')
    .execute()
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable('mfa_evidences').execute()
}
