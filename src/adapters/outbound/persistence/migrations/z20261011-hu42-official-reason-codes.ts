import { sql, type Kysely } from 'kysely'

/**
 * HU-42 (RF-42, PDF "Proyecto Integrador II" v1.26.10 §7.3.2): el catálogo de
 * causales solo tenía OTHER y AUCTION_TERMS_VIOLATION (HU-90, CA-05). Esta
 * migración amplía el CHECK constraint con las 8 causales oficiales, sin
 * tocar ninguna fila existente: ninguna sanción persistida cambia de código.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table sanctions drop constraint sanctions_codigo_motivo_conocido`.execute(db)

  await sql`
    alter table sanctions
    add constraint sanctions_codigo_motivo_conocido
    check (reason_code in (
      'OTHER',
      'AUCTION_TERMS_VIOLATION',
      'OFFENSIVE_LANGUAGE',
      'HARASSMENT',
      'FRAUD_OR_MANIPULATION',
      'UNAUTHORIZED_SOFTWARE_OR_CHEATING',
      'IDENTITY_IMPERSONATION',
      'PRIVACY_POLICY_VIOLATION',
      'TERMS_OF_SERVICE_VIOLATION',
      'LEGAL_RELATIONSHIP_TERMINATION'
    ))
  `.execute(db)
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table sanctions drop constraint sanctions_codigo_motivo_conocido`.execute(db)

  await sql`
    alter table sanctions
    add constraint sanctions_codigo_motivo_conocido
    check (reason_code in ('OTHER', 'AUCTION_TERMS_VIOLATION'))
  `.execute(db)
}
