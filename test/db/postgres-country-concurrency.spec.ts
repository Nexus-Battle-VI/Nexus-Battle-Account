import { sql, type Kysely } from 'kysely'
import { startTestPostgres, type TestPostgres } from './postgres-runtime'
import { createDatabase, migrateToLatest } from '../../src/infrastructure/persistence/database'
import type { Database } from '../../src/adapters/outbound/persistence/schema'
import { PostgresAccountRepository } from '../../src/adapters/outbound/persistence/PostgresAccountRepository'
import { CountryCode } from '../../src/domain/value-objects/CountryCode'
import { DisplayName } from '../../src/domain/value-objects/DisplayName'
import { buildActiveAccount } from '../support/account-factory'
import { countryConcurrencyContract } from '../support/country-concurrency-contract'

describe('Pais del perfil bajo escrituras concurrentes PostgreSQL', () => {
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
  countryConcurrencyContract(() => accounts)

  it('un rollback conserva la intencion de pais para un reintento posterior', async () => {
    const target = buildActiveAccount({
      id: 'country-failed',
      subject: 'country-failed',
      email: 'failed-country@example.test',
      displayName: 'Nombre Libre',
    })
    const occupied = buildActiveAccount({
      id: 'country-occupied',
      subject: 'country-occupied',
      email: 'occupied-country@example.test',
      displayName: 'Nombre Ocupado',
    })
    await accounts.save(target)
    await accounts.save(occupied)
    target.changeCountryCode(CountryCode.create('CO'))
    target.rename(DisplayName.create('Nombre Ocupado'))
    await expect(accounts.save(target)).rejects.toThrow()
    expect((await accounts.findById(target.id))!.currentCountryCode).toBeNull()
    target.rename(DisplayName.create('Nombre Reintentado'))
    await accounts.save(target)
    expect((await accounts.findById(target.id))!.toSnapshot()).toMatchObject({
      countryCode: 'CO',
      displayName: 'Nombre Reintentado',
    })
  })
})
