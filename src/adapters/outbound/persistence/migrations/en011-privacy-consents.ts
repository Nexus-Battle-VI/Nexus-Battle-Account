import { sql, type Kysely } from 'kysely'

/**
 * Consentimiento versionado de privacidad (EN-011, CA-02).
 *
 * APPEND-ONLY a proposito: `id` es una clave tecnica generada por
 * `IdGeneratorPort`, no hay restriccion de unicidad sobre `(account_id,
 * policy_version)` ni sobre nada que impida varias filas para la misma
 * cuenta. Que una cuenta acepte v0.3 y despues v0.4 debe dejar DOS filas, no
 * una fila que cambio de valor -es el requisito de historial de ADR-014,
 * Decision 1: una aceptacion anterior no puede quedar destruida cuando se
 * acepta una version futura-.
 *
 * `account_id` referencia `accounts` DENTRO del mismo servicio -la
 * prohibicion del proyecto es sobre claves foraneas ENTRE servicios, ver
 * `001-accounts`-. `on delete cascade` porque si la cuenta deja de existir
 * -HU-43, todavia no implementada- su evidencia de consentimiento no tiene
 * titular que la reclame; la excepcion de retencion que HU-43 pueda definir
 * para esta tabla es una decision de esa implementacion, no de esta migracion.
 *
 * No hay `NOT NULL` que exija `accepted_at <= created_at` ni comparacion entre
 * ambos: `accepted_at` es el instante que `RegisterAccount` calculo con
 * `ClockPort` para TODO el registro -cuenta y consentimiento a la vez-, y
 * `created_at` es solo la marca de auditoria de la fila, igual que en
 * `account_security_answers`. Pueden coincidir exactamente y es lo esperado.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createTable('account_privacy_consents')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('account_id', 'text', (col) =>
      col.notNull().references('accounts.id').onDelete('cascade'),
    )
    .addColumn('policy_version', 'text', (col) => col.notNull())
    .addColumn('accepted_at', 'timestamptz', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  // Historial por cuenta: `findPrivacyConsents` siempre filtra por
  // `account_id` y ordena por `accepted_at`. Sin este indice, cada lectura
  // recorreria la tabla entera a medida que crezca.
  await db.schema
    .createIndex('account_privacy_consents_account_id_idx')
    .on('account_privacy_consents')
    .column('account_id')
    .execute()
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable('account_privacy_consents').execute()
}
