import { sql, type Kysely } from 'kysely'

import { SECURITY_QUESTION_SEED } from '../security-question-seed'

/**
 * HU-01: perfil de registro, avatar por metadatos, preguntas y lista negra.
 *
 * No toca `001-accounts`. El vocabulario de estados y roles sigue alli.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .alterTable('accounts')
    .addColumn('first_names', 'text', (col) => col.notNull())
    .addColumn('last_names', 'text', (col) => col.notNull())
    .addColumn('terms_accepted', 'boolean', (col) => col.notNull())
    .addColumn('avatar_storage_key', 'text', (col) => col.notNull())
    .addColumn('avatar_mime_type', 'text', (col) => col.notNull())
    .addColumn('avatar_size_bytes', 'integer', (col) => col.notNull())
    .addColumn('avatar_original_name', 'text', (col) => col.notNull())
    .execute()

  await sql`
    alter table accounts
      add constraint accounts_avatar_mime_imagen
      check (avatar_mime_type like 'image/%')
  `.execute(db)

  await sql`
    alter table accounts
      add constraint accounts_avatar_tamano
      check (avatar_size_bytes > 0 and avatar_size_bytes <= 524288000)
  `.execute(db)

  await sql`
    create unique index accounts_display_name_ci on accounts (lower(display_name))
  `.execute(db)

  await db.schema
    .createTable('security_questions')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('statement', 'text', (col) => col.notNull())
    .addColumn('active', 'boolean', (col) => col.notNull())
    .execute()

  await db.schema
    .createTable('account_security_answers')
    .addColumn('account_id', 'text', (col) =>
      col.notNull().references('accounts.id').onDelete('cascade'),
    )
    .addColumn('question_id', 'text', (col) => col.notNull().references('security_questions.id'))
    .addColumn('answer_hash', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('account_security_answers_pk', ['account_id', 'question_id'])
    .execute()

  await db.schema
    .createTable('nickname_blacklist_entries')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('term', 'text', (col) => col.notNull())
    .addColumn('active', 'boolean', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  for (const question of SECURITY_QUESTION_SEED) {
    await sql`
      insert into security_questions (id, statement, active)
      values (${question.id}, ${question.statement}, true)
    `.execute(db)
  }
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable('account_security_answers').execute()
  await db.schema.dropTable('security_questions').execute()
  await db.schema.dropTable('nickname_blacklist_entries').execute()
  await sql`drop index if exists accounts_display_name_ci`.execute(db)
  await sql`
    alter table accounts
      drop constraint if exists accounts_avatar_mime_imagen,
      drop constraint if exists accounts_avatar_tamano
  `.execute(db)
  await db.schema
    .alterTable('accounts')
    .dropColumn('first_names')
    .dropColumn('last_names')
    .dropColumn('terms_accepted')
    .dropColumn('avatar_storage_key')
    .dropColumn('avatar_mime_type')
    .dropColumn('avatar_size_bytes')
    .dropColumn('avatar_original_name')
    .execute()
}
