import { sql, type Kysely } from 'kysely'
import { startTestPostgres, type TestPostgres } from './postgres-runtime'
import { createDatabase, migrateToLatest } from '../../src/infrastructure/persistence/database'
import type { Database } from '../../src/adapters/outbound/persistence/schema'
import { PostgresAccountRepository } from '../../src/adapters/outbound/persistence/PostgresAccountRepository'
import { PreferredLanguage } from '../../src/domain/value-objects/PreferredLanguage'
import { buildActiveAccount } from '../support/account-factory'
import { languageConcurrencyContract } from '../support/language-concurrency-contract'

/**
 * Idioma preferido (HU-05, CA-04) contra PostgreSQL real: la columna, su
 * restriccion y el control de intencion del repositorio.
 */
describe('Idioma preferido en PostgreSQL', () => {
  let server: TestPostgres
  let db: Kysely<Database>
  let accounts: PostgresAccountRepository

  beforeAll(async () => {
    server = await startTestPostgres()
    db = createDatabase({ connectionString: server.getConnectionUri() })
    const outcome = await migrateToLatest(db)
    if (outcome.error !== undefined)
      throw outcome.error instanceof Error
        ? outcome.error
        : new Error('No se aplicaron migraciones', { cause: outcome.error })
  })
  afterAll(async () => {
    await db.destroy()
    await server.stop()
  })
  beforeEach(async () => {
    await sql`truncate accounts cascade`.execute(db)
    accounts = new PostgresAccountRepository(db)
  })

  languageConcurrencyContract(() => accounts)

  it('una cuenta existente sin idioma se lee con null', async () => {
    const target = buildActiveAccount({
      id: 'language-legacy',
      subject: 'legacy-language',
      email: 'legacy-language@example.test',
      displayName: 'Cuenta Antigua',
    })
    await accounts.save(target)

    const row = await db
      .selectFrom('accounts')
      .select('preferred_language')
      .where('id', '=', 'language-legacy')
      .executeTakeFirstOrThrow()
    expect(row.preferred_language).toBeNull()
    expect((await accounts.findById(target.id))!.currentPreferredLanguage).toBeNull()
  })

  it.each(['es', 'en', 'fr', 'pt'] as const)('persiste y relee %s', async (language) => {
    const target = buildActiveAccount({
      id: `language-${language}`,
      subject: `subject-${language}`,
      email: `language-${language}@example.test`,
      displayName: `Idioma ${language}`,
    })
    target.changePreferredLanguage(PreferredLanguage.create(language))
    await accounts.save(target)

    expect((await accounts.findById(target.id))!.currentPreferredLanguage?.value).toBe(language)
  })

  it('la restriccion rechaza un valor fuera de la lista aunque se escriba sin el dominio', async () => {
    const target = buildActiveAccount({
      id: 'language-check',
      subject: 'check-language',
      email: 'check-language@example.test',
      displayName: 'Idioma Check',
    })
    await accounts.save(target)

    for (const invalid of ['de', 'es-ES', 'EN', '']) {
      await expect(
        db
          .updateTable('accounts')
          .set({ preferred_language: invalid })
          .where('id', '=', 'language-check')
          .execute(),
      ).rejects.toThrow(/accounts_preferred_language_allowed/u)
    }
  })

  it('la columna es nullable y sin valor por defecto (compatible con la imagen anterior)', async () => {
    const column = await sql<{ is_nullable: string; column_default: string | null }>`
      select is_nullable, column_default
      from information_schema.columns
      where table_name = 'accounts' and column_name = 'preferred_language'
    `.execute(db)

    expect(column.rows).toEqual([{ is_nullable: 'YES', column_default: null }])
  })
})
