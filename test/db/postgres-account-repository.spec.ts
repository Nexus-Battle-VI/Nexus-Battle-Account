import 'reflect-metadata'

import { startTestPostgres, type TestPostgres } from './postgres-runtime'
import { sql, type Kysely } from 'kysely'

import { describeError } from '../../src/infrastructure/observability/describe-error'
import { createDatabase, migrateToLatest } from '../../src/infrastructure/persistence/database'
import { PostgresAccountRepository } from '../../src/adapters/outbound/persistence/PostgresAccountRepository'
import { PostgresNicknameBlacklist } from '../../src/adapters/outbound/persistence/PostgresNicknameBlacklist'
import { PostgresSecurityQuestionCatalog } from '../../src/adapters/outbound/persistence/PostgresSecurityQuestionCatalog'
import type { Database } from '../../src/adapters/outbound/persistence/schema'
import { Account } from '../../src/domain/entities/Account'
import { AccountId } from '../../src/domain/value-objects/AccountId'
import { DisplayName } from '../../src/domain/value-objects/DisplayName'
import { CountryCode } from '../../src/domain/value-objects/CountryCode'
import { UpdateOwnAccount } from '../../src/application/use-cases/UpdateOwnAccount'
import { EmailAddress } from '../../src/domain/value-objects/EmailAddress'
import { PersonName } from '../../src/domain/value-objects/PersonName'
import { Role } from '../../src/domain/entities/Role'
import { AccountStatus } from '../../src/domain/entities/AccountStatus'
import { defaultAvatarMetadata } from '../support/account-factory'
import { InMemoryAccountRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountRepository'
import { ListAdminAccounts } from '../../src/application/use-cases/ListAdminAccounts'
import type { AdminAccountQueryCriteria } from '../../src/application/dto/AdminAccountQueryCriteria'
import { ExportAdminAccounts } from '../../src/application/use-cases/ExportAdminAccounts'
import { JsonAdminAccountExportAdapter } from '../../src/adapters/outbound/export/JsonAdminAccountExportAdapter'
import { InMemorySanctionRepository } from '../../src/adapters/outbound/persistence/InMemorySanctionRepository'
import { PostgresSanctionRepository } from '../../src/adapters/outbound/persistence/PostgresSanctionRepository'
import { Sanction } from '../../src/domain/entities/Sanction'
import { SanctionType } from '../../src/domain/entities/SanctionType'

/**
 * Adaptador de PostgreSQL contra un motor REAL, en contenedor.
 *
 * Estas pruebas viven aparte de la suite por defecto porque necesitan Docker.
 * Lo que comprueban no se puede comprobar de otra forma: que el SQL sea valido,
 * que las restricciones existan de verdad y que la transaccion haga lo que dice.
 * Un doble de prueba habria pasado con un esquema equivocado.
 */
describe('PostgresAccountRepository', () => {
  let container: TestPostgres
  let db: Kysely<Database>
  let repository: PostgresAccountRepository

  const AT = new Date('2026-08-25T10:00:00.000Z')
  let contador = 0

  const buildAccount = (): Account => {
    contador += 1

    const id = `acc-${String(contador)}`

    return Account.register({
      id: AccountId.create(id),
      subject: `sujeto-${String(contador)}`,
      email: EmailAddress.create(`persona${String(contador)}@nexus.test`),
      displayName: DisplayName.create(`Ana ${String(contador)}`),
      firstNames: PersonName.create('Ana', 'Los nombres'),
      lastNames: PersonName.create('Ramirez', 'Los apellidos'),
      termsAccepted: true,
      avatar: defaultAvatarMetadata(id),
      occurredAt: AT,
    })
  }

  interface AdminQuerySeed {
    readonly id: string
    readonly subject: string
    readonly email: string
    readonly displayName: string
    readonly firstNames: string
    readonly lastNames: string
    readonly status: AccountStatus
    readonly roles: readonly Role[]
    readonly registeredAt: Date
  }

  const ADMIN_QUERY_SEEDS: readonly AdminQuerySeed[] = [
    {
      id: 'acc-query-admin',
      subject: 'subject-query-admin',
      email: 'query.admin@nexus.test',
      displayName: 'Capitana Query',
      firstNames: 'Ada',
      lastNames: 'Lovelace',
      status: AccountStatus.Active,
      roles: [Role.Player, Role.Administrator],
      registeredAt: new Date('2026-08-10T10:00:00.000Z'),
    },
    {
      id: 'acc-query-super',
      subject: 'subject-query-super',
      email: 'query.super@nexus.test',
      displayName: 'Raiz Query',
      firstNames: 'Grace',
      lastNames: 'Hopper',
      status: AccountStatus.Active,
      roles: [Role.SuperAdministrator],
      registeredAt: new Date('2026-08-11T10:00:00.000Z'),
    },
    {
      id: 'acc-query-suspended',
      subject: 'subject-query-suspended',
      email: 'query.suspended@nexus.test',
      displayName: 'Moderadora Query',
      firstNames: 'Katherine',
      lastNames: 'Johnson',
      status: AccountStatus.Suspended,
      roles: [Role.Player, Role.Moderator],
      registeredAt: new Date('2026-08-12T10:00:00.000Z'),
    },
  ]

  const buildAdminQueryAccount = (seed: AdminQuerySeed): Account =>
    Account.restore({
      id: AccountId.create(seed.id),
      subject: seed.subject,
      email: EmailAddress.create(seed.email),
      displayName: DisplayName.create(seed.displayName),
      firstNames: PersonName.create(seed.firstNames, 'Los nombres'),
      lastNames: PersonName.create(seed.lastNames, 'Los apellidos'),
      termsAccepted: true,
      avatar: defaultAvatarMetadata(seed.id),
      status: seed.status,
      roles: seed.roles,
    })

  const seedAdminQueryAccounts = async (memory?: InMemoryAccountRepository): Promise<void> => {
    await db.deleteFrom('accounts').execute()

    for (const seed of ADMIN_QUERY_SEEDS) {
      const account = buildAdminQueryAccount(seed)
      await memory?.save(account)
      await repository.save(account)
      await db
        .updateTable('accounts')
        .set({ created_at: seed.registeredAt, updated_at: seed.registeredAt })
        .where('id', '=', seed.id)
        .execute()
    }
  }

  beforeAll(async () => {
    container = await startTestPostgres()
    db = createDatabase({ connectionString: container.getConnectionUri() })

    const { error } = await migrateToLatest(db)

    if (error !== undefined) {
      throw new Error(`Las migraciones fallaron: ${describeError(error)}`)
    }
  }, 120_000)

  afterAll(async () => {
    await db.destroy()
    await container.stop()
  })

  it('guarda y recupera una cuenta por su identificador', async () => {
    const account = buildAccount()
    await repository.save(account)

    const found = await repository.findById(account.id)

    expect(found?.toSnapshot()).toEqual(account.toSnapshot())
  })

  it.each(['save', 'saveRegistration'] as const)(
    'conserva created_at generado por PostgreSQL en %s tras actualizar y recrear el repositorio',
    async (method) => {
      const account = buildAccount()
      const databaseTime = async (): Promise<Date> => {
        const result = await sql<{ now: Date }>`select clock_timestamp() as now`.execute(db)
        return result.rows[0]!.now
      }
      const beforeInsert = await databaseTime()
      await repository[method](account, [])
      const afterInsert = await databaseTime()
      const readStored = () =>
        db
          .selectFrom('accounts')
          .selectAll()
          .where('id', '=', account.id.value)
          .executeTakeFirstOrThrow()
      const inserted = await readStored()

      expect(inserted.created_at.getTime()).toBeGreaterThanOrEqual(beforeInsert.getTime())
      expect(inserted.created_at.getTime()).toBeLessThanOrEqual(afterInsert.getTime())

      const updatedName = `Fecha ${method}`
      account.rename(DisplayName.create(updatedName))
      await repository.save(account)
      const updated = await readStored()
      expect(updated.display_name).toBe(updatedName)
      expect(updated.created_at).toEqual(inserted.created_at)

      const restarted = new PostgresAccountRepository(db)
      const list = new ListAdminAccounts(restarted)
      const listed = await list.execute({ id: account.id.value })
      expect(listed.items).toEqual([
        expect.objectContaining({ registeredAt: inserted.created_at.toISOString() }),
      ])
      const file = await new ExportAdminAccounts(list, new JsonAdminAccountExportAdapter()).execute(
        {
          id: account.id.value,
        },
      )
      expect(JSON.parse(file.content)).toEqual(listed.items)
      expect(await readStored()).toEqual(updated)
    },
  )

  it('persiste país nullable, preserva campos omitidos y lo incluye en proyección/exportación', async () => {
    const account = buildAccount()
    await repository.save(account)
    expect((await repository.findById(account.id))?.currentCountryCode).toBeNull()
    const update = new UpdateOwnAccount(repository, new PostgresNicknameBlacklist(db))
    await update.execute({ subject: account.subject, countryCode: 'co' })
    await update.execute({ subject: account.subject, displayName: 'Pais Persistente' })
    const restarted = new PostgresAccountRepository(db)
    expect((await restarted.findById(account.id))?.toSnapshot()).toMatchObject({
      countryCode: 'CO',
      displayName: 'Pais Persistente',
    })
    const exported = await new ExportAdminAccounts(
      new ListAdminAccounts(restarted),
      new JsonAdminAccountExportAdapter(),
    ).execute({ id: account.id.value })
    expect(JSON.parse(exported.content)).toEqual([expect.objectContaining({ countryCode: 'CO' })])
    account.changeCountryCode(CountryCode.create('US'))
    await repository.save(account)
    expect((await restarted.findBySubject(account.subject))?.currentCountryCode?.value).toBe('US')
    await update.execute({ subject: account.subject, countryCode: null })
    expect((await restarted.findBySubject(account.subject))?.currentCountryCode).toBeNull()
    await expect(
      db
        .updateTable('accounts')
        .set({ country_code: 'col' })
        .where('id', '=', account.id.value)
        .execute(),
    ).rejects.toThrow()
  })

  it('recupera por correo y por sujeto', async () => {
    const account = buildAccount()
    await repository.save(account)

    const porCorreo = await repository.findByEmail(account.currentEmail)
    const porSujeto = await repository.findBySubject(account.subject)

    expect(porCorreo?.id.value).toBe(account.id.value)
    expect(porSujeto?.id.value).toBe(account.id.value)
  })

  it('devuelve null cuando no existe, por cualquiera de los tres caminos', async () => {
    expect(await repository.findById(AccountId.create('acc-inexistente'))).toBeNull()
    expect(await repository.findBySubject('sujeto-inexistente')).toBeNull()
    expect(await repository.findByEmail(EmailAddress.create('nadie@nexus.test'))).toBeNull()
  })

  it('responde sobre la existencia por apodo', async () => {
    const account = buildAccount()
    await repository.save(account)

    expect(await repository.existsByDisplayName(account.currentDisplayName)).toBe(true)
    expect(await repository.existsByDisplayName(DisplayName.create('Otro Apodo'))).toBe(false)
  })

  /**
   * HU-02: el login por apodo reutiliza el indice unico insensible a
   * mayusculas ya creado en la migracion de HU-01 (`accounts_display_name_ci`),
   * no uno nuevo.
   */
  it('recupera por apodo sin distinguir mayusculas (HU-02)', async () => {
    const account = buildAccount()
    await repository.save(account)

    const encontrada = await repository.findByDisplayName(account.currentDisplayName)
    const enMayusculas = await repository.findByDisplayName(
      DisplayName.create(account.currentDisplayName.value.toUpperCase()),
    )

    expect(encontrada?.id.value).toBe(account.id.value)
    expect(enMayusculas?.id.value).toBe(account.id.value)
    expect(await repository.findByDisplayName(DisplayName.create('Nadie Aqui'))).toBeNull()
  })

  it('responde sobre la existencia por correo', async () => {
    const account = buildAccount()
    await repository.save(account)

    expect(await repository.existsByEmail(account.currentEmail)).toBe(true)
    expect(await repository.existsByEmail(EmailAddress.create('nadie@nexus.test'))).toBe(false)
  })

  /**
   * El mismo contrato que cumple el repositorio en memoria: una mutacion que no
   * se guarda NO debe filtrarse al almacen. Es lo que hace que una prueba falle
   * cuando un caso de uso olvida llamar a `save`.
   */
  it('no filtra al almacen una mutacion sin guardar', async () => {
    const account = buildAccount()
    await repository.save(account)

    account.grantRole(Role.Moderator, new Set([Role.SuperAdministrator]))

    const found = await repository.findById(account.id)

    expect(found?.currentRoles).toEqual([Role.Player])
  })

  it('actualiza la cuenta existente en lugar de duplicarla', async () => {
    const account = buildAccount()
    await repository.save(account)

    account.verify(AT)
    account.grantRole(Role.Moderator, new Set([Role.SuperAdministrator]))
    await repository.save(account)

    const found = await repository.findById(account.id)

    expect(found?.currentStatus).toBe(AccountStatus.Active)
    expect(found?.currentRoles).toEqual([Role.Player, Role.Moderator])

    const filas = await db
      .selectFrom('accounts')
      .select(({ fn }) => fn.countAll().as('total'))
      .where('id', '=', account.id.value)
      .executeTakeFirstOrThrow()

    expect(Number(filas.total)).toBe(1)
  })

  /**
   * HU-05 / CA-07: la unica edicion de "Mi Cuenta" es el apodo. Esta prueba
   * cierra el ciclo contra el motor REAL: `account.rename(...)` ->
   * `repository.save(account)` -> relectura desde PostgreSQL -> `display_name`
   * actualizado, tanto en el agregado rehidratado como en la columna cruda.
   * Un doble en memoria no demuestra que el `onConflict ... doUpdateSet` incluya
   * de verdad `display_name`.
   */
  it('persiste el nuevo apodo tras rename y lo devuelve en una relectura (HU-05/CA-07)', async () => {
    const account = buildAccount()
    await repository.save(account)

    account.rename(DisplayName.create('Apodo Renombrado'))
    await repository.save(account)

    const reread = await repository.findById(account.id)
    expect(reread?.currentDisplayName.value).toBe('Apodo Renombrado')

    const row = await db
      .selectFrom('accounts')
      .select('display_name')
      .where('id', '=', account.id.value)
      .executeTakeFirstOrThrow()

    expect(row.display_name).toBe('Apodo Renombrado')
  })

  /**
   * Los roles se reemplazan por completo: el agregado es la autoridad sobre su
   * conjunto. Retirar uno tiene que borrarlo de verdad, no dejarlo huerfano.
   */
  it('retira los roles que el agregado ya no tiene', async () => {
    const account = buildAccount()
    account.grantRole(Role.Moderator, new Set([Role.SuperAdministrator]))
    await repository.save(account)

    account.revokeRole(Role.Moderator, new Set([Role.SuperAdministrator]))
    await repository.save(account)

    const roles = await db
      .selectFrom('account_roles')
      .select('role')
      .where('account_id', '=', account.id.value)
      .execute()

    expect(roles.map((r) => r.role)).toEqual([Role.Player])
  })

  it('mantiene paridad con memoria para los filtros administrativos soportados', async () => {
    let nextDate = 0
    const memory = new InMemoryAccountRepository(
      () => ADMIN_QUERY_SEEDS[nextDate++]?.registeredAt ?? new Date('2026-08-31T00:00:00.000Z'),
    )

    await seedAdminQueryAccounts(memory)

    const criteria: readonly AdminAccountQueryCriteria[] = [
      {},
      { id: 'acc-query-admin' },
      { email: 'QUERY.ADMIN@NEXUS.TEST' },
      { firstNames: 'ada' },
      { lastNames: 'hopper' },
      { displayName: 'raiz query' },
      { role: Role.SuperAdministrator },
      { status: AccountStatus.Suspended },
      { role: Role.Player, status: AccountStatus.Active },
    ]

    const memoryUseCase = new ListAdminAccounts(memory)
    const postgresUseCase = new ListAdminAccounts(repository)

    for (const criterion of criteria) {
      await expect(postgresUseCase.execute(criterion)).resolves.toEqual(
        await memoryUseCase.execute(criterion),
      )
    }
  })

  it('filtra historial real HU-42 con paridad, sin duplicados ni mutaciones', async () => {
    const sanctions = new PostgresSanctionRepository(db)
    const memorySanctions = new InMemorySanctionRepository()
    let nextDate = 0
    const memory = new InMemoryAccountRepository(
      () => ADMIN_QUERY_SEEDS[nextDate++]?.registeredAt ?? AT,
      memorySanctions,
    )
    await seedAdminQueryAccounts(memory)
    await db.deleteFrom('sanctions').execute()
    const banned = buildAdminQueryAccount({
      id: 'acc-query-banned',
      subject: 'subject-query-banned',
      email: 'banned@nexus.test',
      displayName: 'Jugador Baneado',
      firstNames: 'Diego',
      lastNames: 'Torres',
      status: AccountStatus.Banned,
      roles: [Role.Player],
      registeredAt: AT,
    })
    await repository.save(banned)
    await memory.save(banned)
    await db
      .updateTable('accounts')
      .set({ created_at: AT })
      .where('id', '=', banned.id.value)
      .execute()

    for (const [id, targetAccountId, type] of [
      ['warning', 'acc-query-admin', SanctionType.Warning],
      ['warning-again', 'acc-query-admin', SanctionType.Warning],
      ['expired', 'acc-query-suspended', SanctionType.TemporarySuspension],
      ['ban', 'acc-query-banned', SanctionType.PermanentBan],
      ['deleted', 'acc-deleted', SanctionType.Warning],
    ] as const) {
      const sanction = Sanction.create({
        id,
        targetAccountId,
        actorAccountId: 'acc-query-super',
        type,
        reason: 'Causal sintetica HU-44.2',
        createdAt: new Date('2020-01-01T00:00:00.000Z'),
        expiresAt:
          type === SanctionType.TemporarySuspension ? new Date('2020-01-02T00:00:00.000Z') : null,
      })
      await sanctions.save(sanction)
      await memorySanctions.save(sanction)
    }
    const readStored = async () => ({
      accounts: await db.selectFrom('accounts').selectAll().orderBy('id').execute(),
      roles: await db
        .selectFrom('account_roles')
        .selectAll()
        .orderBy('account_id')
        .orderBy('role')
        .execute(),
      sanctions: await db.selectFrom('sanctions').selectAll().orderBy('id').execute(),
    })
    const before = await readStored()
    const memoryUseCase = new ListAdminAccounts(memory)
    const postgresUseCase = new ListAdminAccounts(repository)
    const exporter = new ExportAdminAccounts(postgresUseCase, new JsonAdminAccountExportAdapter())
    const cases: readonly [AdminAccountQueryCriteria, readonly string[]][] = [
      [
        { hasSanctionHistory: true },
        ['acc-query-admin', 'acc-query-banned', 'acc-query-suspended'],
      ],
      [{ hasSanctionHistory: false }, ['acc-query-super']],
      [{ hasSanctionHistory: true, id: 'acc-query-admin' }, ['acc-query-admin']],
      [{ hasSanctionHistory: true, status: AccountStatus.Suspended }, ['acc-query-suspended']],
      [{ hasSanctionHistory: true, status: AccountStatus.Banned }, ['acc-query-banned']],
      [{ hasSanctionHistory: true, role: Role.Moderator }, ['acc-query-suspended']],
      [{ hasSanctionHistory: false, role: Role.SuperAdministrator }, ['acc-query-super']],
      [
        {
          hasSanctionHistory: true,
          displayName: 'capitana query',
          role: Role.Administrator,
          status: AccountStatus.Active,
        },
        ['acc-query-admin'],
      ],
      [{ hasSanctionHistory: false, email: 'query.admin@nexus.test' }, []],
    ]
    for (const [criteria, ids] of cases) {
      const listed = await postgresUseCase.execute(criteria)
      expect(listed.items.map((item) => item.id)).toEqual(ids)
      expect(listed).toEqual(await memoryUseCase.execute(criteria))
      expect(JSON.parse((await exporter.execute(criteria)).content)).toEqual(listed.items)
    }
    expect((await postgresUseCase.execute({ hasSanctionHistory: true })).statusCounts).toEqual({
      pendingVerification: 0,
      active: 1,
      suspended: 1,
      banned: 1,
    })
    expect(await sanctions.findAccountIdsWithHistory([])).toEqual([])
    const candidates = [
      'acc-query-admin',
      'acc-query-admin',
      'acc-query-super',
      'acc-query-suspended',
    ]
    expect([...(await sanctions.findAccountIdsWithHistory(candidates))].sort()).toEqual(
      [...(await memorySanctions.findAccountIdsWithHistory(candidates))].sort(),
    )
    expect(await readStored()).toEqual(before)
  })

  it('aplica limites inclusivos sobre timestamptz con paridad, AND y exportacion sin mutaciones', async () => {
    const memorySanctions = new InMemorySanctionRepository()
    const sanctions = new PostgresSanctionRepository(db)
    let nextDate = 0
    const memory = new InMemoryAccountRepository(
      () => ADMIN_QUERY_SEEDS[nextDate++]?.registeredAt ?? AT,
      memorySanctions,
    )
    await seedAdminQueryAccounts(memory)
    await db.deleteFrom('sanctions').execute()
    const sanction = Sanction.create({
      id: 'date-range-warning',
      targetAccountId: 'acc-query-admin',
      actorAccountId: 'acc-query-super',
      type: SanctionType.Warning,
      reason: 'Causal sintetica',
      createdAt: AT,
    })
    await sanctions.save(sanction)
    await memorySanctions.save(sanction)
    const column = await sql<{ data_type: string }>`select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'accounts' and column_name = 'created_at'`.execute(
      db,
    )
    expect(column.rows[0]?.data_type).toBe('timestamp with time zone')

    const readStored = async () => ({
      accounts: await db.selectFrom('accounts').selectAll().orderBy('id').execute(),
      roles: await db
        .selectFrom('account_roles')
        .selectAll()
        .orderBy('account_id')
        .orderBy('role')
        .execute(),
      sanctions: await db.selectFrom('sanctions').selectAll().orderBy('id').execute(),
    })
    const before = await readStored()
    const list = new ListAdminAccounts(repository)
    const memoryList = new ListAdminAccounts(memory)
    const exportAccounts = new ExportAdminAccounts(list, new JsonAdminAccountExportAdapter())
    const cases: readonly [AdminAccountQueryCriteria, readonly string[]][] = [
      [{}, ['acc-query-admin', 'acc-query-super', 'acc-query-suspended']],
      [
        { registeredFrom: new Date('2026-08-11T10:00:00Z') },
        ['acc-query-super', 'acc-query-suspended'],
      ],
      [{ registeredTo: new Date('2026-08-11T10:00:00Z') }, ['acc-query-admin', 'acc-query-super']],
      [
        {
          registeredFrom: new Date('2026-08-10T10:00:00Z'),
          registeredTo: new Date('2026-08-11T10:00:00Z'),
        },
        ['acc-query-admin', 'acc-query-super'],
      ],
      [
        {
          registeredFrom: new Date('2026-08-11T05:00:00-05:00'),
          registeredTo: new Date('2026-08-11T10:00:00Z'),
        },
        ['acc-query-super'],
      ],
      [{ registeredFrom: new Date('2026-08-11T10:00:00.001Z') }, ['acc-query-suspended']],
      [{ registeredTo: new Date('2026-08-11T09:59:59.999Z') }, ['acc-query-admin']],
      [
        {
          registeredFrom: new Date('2027-01-01T00:00:00Z'),
          registeredTo: new Date('2027-02-01T00:00:00Z'),
        },
        [],
      ],
      [
        { registeredFrom: new Date('2026-08-10T10:00:00Z'), firstNames: 'ada' },
        ['acc-query-admin'],
      ],
      [
        { registeredTo: new Date('2026-08-11T10:00:00Z'), role: Role.SuperAdministrator },
        ['acc-query-super'],
      ],
      [
        { registeredFrom: new Date('2026-08-11T10:00:00Z'), status: AccountStatus.Suspended },
        ['acc-query-suspended'],
      ],
      [
        { registeredTo: new Date('2026-08-11T10:00:00Z'), hasSanctionHistory: true },
        ['acc-query-admin'],
      ],
      [
        {
          registeredFrom: new Date('2026-08-11T10:00:00Z'),
          registeredTo: new Date('2026-08-12T10:00:00Z'),
          hasSanctionHistory: false,
        },
        ['acc-query-super', 'acc-query-suspended'],
      ],
      [
        {
          registeredFrom: new Date('2026-08-10T10:00:00Z'),
          registeredTo: new Date('2026-08-11T10:00:00Z'),
          displayName: 'capitana query',
          role: Role.Administrator,
          status: AccountStatus.Active,
          hasSanctionHistory: true,
        },
        ['acc-query-admin'],
      ],
      [
        {
          registeredFrom: new Date('2026-08-11T10:00:00Z'),
          role: Role.Administrator,
          hasSanctionHistory: true,
        },
        [],
      ],
    ]
    for (const [criteria, ids] of cases) {
      const result = await list.execute(criteria)
      expect(result.items.map((item) => item.id)).toEqual(ids)
      expect(result).toEqual(await memoryList.execute(criteria))
      expect(JSON.parse((await exportAccounts.execute(criteria)).content)).toEqual(result.items)
    }
    expect(await readStored()).toEqual(before)
  })

  it('compara el timestamptz almacenado sin truncar sus microsegundos al filtrar', async () => {
    await seedAdminQueryAccounts()
    await sql`update accounts set created_at = '2026-08-10T10:00:00.000001Z'::timestamptz
      where id = 'acc-query-admin'`.execute(db)
    const criteria = { id: 'acc-query-admin' }
    const list = new ListAdminAccounts(repository)
    expect(
      (await list.execute({ ...criteria, registeredTo: new Date('2026-08-10T10:00:00.000Z') }))
        .items,
    ).toEqual([])
    expect(
      (await list.execute({ ...criteria, registeredFrom: new Date('2026-08-10T10:00:00.001Z') }))
        .items,
    ).toEqual([])
    expect(
      (
        await list.execute({
          ...criteria,
          registeredFrom: new Date('2026-08-10T10:00:00.000Z'),
          registeredTo: new Date('2026-08-10T10:00:00.001Z'),
        })
      ).items.map((item) => item.id),
    ).toEqual(['acc-query-admin'])
  })

  it('exporta desde PostgreSQL el mismo resultado producido por ListAdminAccounts', async () => {
    await seedAdminQueryAccounts()

    const criteria: AdminAccountQueryCriteria = {
      role: Role.Player,
      status: AccountStatus.Active,
    }
    const listAdminAccounts = new ListAdminAccounts(repository)
    const exportAdminAccounts = new ExportAdminAccounts(
      listAdminAccounts,
      new JsonAdminAccountExportAdapter(),
    )
    const accountsBefore = await db
      .selectFrom('accounts')
      .select([
        'id',
        'email',
        'display_name',
        'first_names',
        'last_names',
        'status',
        'created_at',
        'updated_at',
      ])
      .orderBy('id')
      .execute()
    const rolesBefore = await db
      .selectFrom('account_roles')
      .select(['account_id', 'role'])
      .orderBy('account_id')
      .orderBy('role')
      .execute()

    const listed = await listAdminAccounts.execute(criteria)
    const file = await exportAdminAccounts.execute(criteria)
    const exported = JSON.parse(file.content) as unknown
    const accountsAfter = await db
      .selectFrom('accounts')
      .select([
        'id',
        'email',
        'display_name',
        'first_names',
        'last_names',
        'status',
        'created_at',
        'updated_at',
      ])
      .orderBy('id')
      .execute()
    const rolesAfter = await db
      .selectFrom('account_roles')
      .select(['account_id', 'role'])
      .orderBy('account_id')
      .orderBy('role')
      .execute()

    expect(exported).toEqual(listed.items)
    expect(listed.items.map((item) => item.id)).toEqual(['acc-query-admin'])
    expect(accountsAfter).toEqual(accountsBefore)
    expect(rolesAfter).toEqual(rolesBefore)
  })

  describe('Las restricciones viven en el motor, no solo en el codigo', () => {
    it('impide dos cuentas con el mismo correo', async () => {
      const primera = buildAccount()
      await repository.save(primera)

      const segunda = Account.register({
        id: AccountId.create('acc-correo-repetido'),
        subject: 'sujeto-correo-repetido',
        email: primera.currentEmail,
        displayName: DisplayName.create('Otra Persona'),
        firstNames: PersonName.create('Otra', 'Los nombres'),
        lastNames: PersonName.create('Persona', 'Los apellidos'),
        termsAccepted: true,
        avatar: defaultAvatarMetadata('acc-correo-repetido'),
        occurredAt: AT,
      })

      await expect(repository.save(segunda)).rejects.toThrow()
    })

    it('impide dos cuentas con el mismo sujeto', async () => {
      const primera = buildAccount()
      await repository.save(primera)

      const segunda = Account.register({
        id: AccountId.create('acc-sujeto-repetido'),
        subject: primera.subject,
        email: EmailAddress.create('otra@nexus.test'),
        displayName: DisplayName.create('Otra Persona'),
        firstNames: PersonName.create('Otra', 'Los nombres'),
        lastNames: PersonName.create('Persona', 'Los apellidos'),
        termsAccepted: true,
        avatar: defaultAvatarMetadata('acc-sujeto-repetido'),
        occurredAt: AT,
      })

      await expect(repository.save(segunda)).rejects.toThrow()
    })

    /**
     * La restriccion de vocabulario se comprueba escribiendo directamente en la
     * tabla, sin pasar por el agregado. Es la unica forma de demostrar que la
     * proteccion esta en el motor: a traves del dominio, el rol invalido no
     * llegaria nunca.
     */
    it('rechaza un rol que no pertenece al vocabulario', async () => {
      const account = buildAccount()
      await repository.save(account)

      await expect(
        db
          .insertInto('account_roles')
          .values({ account_id: account.id.value, role: 'SUPERUSUARIO' })
          .execute(),
      ).rejects.toThrow()
    })

    /**
     * La migracion `hu03-super-administrator-role` (HU-02) ALTERA la
     * restriccion original de `001-accounts` para admitir este rol. Esta
     * prueba demuestra que la union de ambas migraciones -no solo la primera-
     * describe el vocabulario vigente en el motor.
     */
    it('acepta SUPER_ADMINISTRATOR tras la migracion de HU-02', async () => {
      const account = buildAccount()
      await repository.save(account)

      await expect(
        db
          .insertInto('account_roles')
          .values({ account_id: account.id.value, role: Role.SuperAdministrator })
          .execute(),
      ).resolves.not.toThrow()

      const found = await repository.findById(account.id)

      expect(found?.currentRoles).toEqual(
        expect.arrayContaining([Role.Player, Role.SuperAdministrator]),
      )
    })

    it('acepta GAME_MASTER tras la migracion de HU-66.1', async () => {
      const account = buildAccount()
      await repository.save(account)

      await expect(
        db
          .insertInto('account_roles')
          .values({ account_id: account.id.value, role: Role.GameMaster })
          .execute(),
      ).resolves.not.toThrow()

      const found = await repository.findById(account.id)

      expect(found?.currentRoles).toEqual(expect.arrayContaining([Role.Player, Role.GameMaster]))
    })

    it('rechaza un estado que no pertenece al vocabulario', async () => {
      const account = buildAccount()
      await repository.save(account)

      await expect(
        db
          .updateTable('accounts')
          .set({ status: 'BORRADO' })
          .where('id', '=', account.id.value)
          .execute(),
      ).rejects.toThrow()
    })
  })

  it('respeta un limite de conexiones explicito', async () => {
    const acotada = createDatabase({
      connectionString: container.getConnectionUri(),
      maxConnections: 2,
    })

    try {
      const cuenta = await acotada
        .selectFrom('accounts')
        .select((eb) => eb.fn.countAll().as('total'))
        .executeTakeFirstOrThrow()

      expect(Number(cuenta.total)).toBeGreaterThanOrEqual(0)
    } finally {
      await acotada.destroy()
    }
  })

  it('la migracion es idempotente: volver a aplicarla no cambia nada', async () => {
    const { applied, error } = await migrateToLatest(db)

    expect(error).toBeUndefined()
    expect(applied).toEqual([])
  })

  describe('HU-01 esquema de registro', () => {
    it('impide dos apodos iguales sin distinguir mayusculas', async () => {
      const primera = buildAccount()
      await repository.save(primera)

      const segunda = Account.register({
        id: AccountId.create('acc-apodo-repetido'),
        subject: 'sujeto-apodo-repetido',
        email: EmailAddress.create('apodo@nexus.test'),
        displayName: DisplayName.create(primera.currentDisplayName.value.toUpperCase()),
        firstNames: PersonName.create('Otra', 'Los nombres'),
        lastNames: PersonName.create('Persona', 'Los apellidos'),
        termsAccepted: true,
        avatar: defaultAvatarMetadata('acc-apodo-repetido'),
        occurredAt: AT,
      })

      await expect(repository.save(segunda)).rejects.toThrow()
    })

    it('no tiene columnas de contrasena', async () => {
      const columns = await sql<{ column_name: string }>`
        select column_name from information_schema.columns where table_name = 'accounts'
      `.execute(db)

      const names = columns.rows.map((row) => row.column_name)

      expect(names.some((name) => name.includes('password') || name.includes('salt'))).toBe(false)
    })

    it('exige terms_accepted y avatar imagen', async () => {
      const account = buildAccount()
      await repository.save(account)

      await expect(
        db
          .updateTable('accounts')
          .set({ avatar_mime_type: 'application/pdf' })
          .where('id', '=', account.id.value)
          .execute(),
      ).rejects.toThrow()
    })

    it('rechaza terms_accepted nulo', async () => {
      const account = buildAccount()
      await repository.save(account)

      await expect(
        sql`update accounts set terms_accepted = null where id = ${account.id.value}`.execute(db),
      ).rejects.toThrow()
    })

    it('rechaza un avatar que supera 500 MB', async () => {
      const account = buildAccount()
      await repository.save(account)

      await expect(
        db
          .updateTable('accounts')
          .set({ avatar_size_bytes: 524_288_001 })
          .where('id', '=', account.id.value)
          .execute(),
      ).rejects.toThrow()
    })

    it('persiste respuestas con PK compuesta y cascada al borrar la cuenta', async () => {
      const account = buildAccount()
      await repository.saveRegistration(account, [
        { questionId: 'sq-01', answerHash: 'a'.repeat(64) },
        { questionId: 'sq-02', answerHash: 'b'.repeat(64) },
      ])

      await expect(
        db
          .insertInto('account_security_answers')
          .values({
            account_id: account.id.value,
            question_id: 'sq-01',
            answer_hash: 'c'.repeat(64),
          })
          .execute(),
      ).rejects.toThrow()

      await expect(
        db
          .insertInto('account_security_answers')
          .values({
            account_id: account.id.value,
            question_id: 'sq-inexistente',
            answer_hash: 'd'.repeat(64),
          })
          .execute(),
      ).rejects.toThrow()

      await db.deleteFrom('accounts').where('id', '=', account.id.value).execute()

      const leftover = await db
        .selectFrom('account_security_answers')
        .selectAll()
        .where('account_id', '=', account.id.value)
        .execute()

      expect(leftover).toEqual([])
    })

    it('el catalogo vigente tiene las cuatro preguntas semilla', async () => {
      const catalog = new PostgresSecurityQuestionCatalog(db)
      const questions = await catalog.listActive()

      expect(questions).toHaveLength(4)
      expect(questions.map((question) => question.id)).toEqual(['sq-01', 'sq-02', 'sq-03', 'sq-04'])
    })

    it('la semilla vigente bloquea terminos conocidos y deja pasar apodos limpios', async () => {
      const blacklist = new PostgresNicknameBlacklist(db)

      expect(await blacklist.isBlocked('Ana Ramirez')).toBe(false)
      expect(await blacklist.isBlocked('admin')).toBe(true)
      expect(await blacklist.isBlocked('xX_Gonorrea_99')).toBe(true)
      expect(await blacklist.isBlocked('AbelardoDeLaEspriella')).toBe(true)
    })

    it('la lista negra solo bloquea terminos activos', async () => {
      const blacklist = new PostgresNicknameBlacklist(db)

      expect(await blacklist.isBlocked('Ana Ramirez')).toBe(false)

      await db
        .insertInto('nickname_blacklist_entries')
        .values({
          id: 'bl-1',
          term: 'ramirez',
          active: false,
        })
        .execute()

      expect(await blacklist.isBlocked('Ana Ramirez')).toBe(false)

      await db
        .insertInto('nickname_blacklist_entries')
        .values({
          id: 'bl-2',
          term: 'ramirez',
          active: true,
        })
        .execute()

      expect(await blacklist.isBlocked('Ana Ramirez')).toBe(true)
    })

    it('rechaza una respuesta huérfana sin cuenta', async () => {
      await expect(
        db
          .insertInto('account_security_answers')
          .values({
            account_id: 'acc-fantasma',
            question_id: 'sq-01',
            answer_hash: 'e'.repeat(64),
          })
          .execute(),
      ).rejects.toThrow()
    })
  })

  describe('deleteById (HU-43.3, tratamiento durable de eliminacion)', () => {
    it('elimina fisicamente la cuenta y hace cascada sobre roles y respuestas de seguridad', async () => {
      const account = buildAccount()
      account.changeCountryCode(CountryCode.create('CO'))
      await repository.saveRegistration(account, [
        { questionId: 'sq-01', answerHash: 'f'.repeat(64) },
      ])

      await repository.deleteById(account.id)

      expect(await repository.findById(account.id)).toBeNull()
      expect(await repository.findSecurityAnswers(account.id)).toEqual([])

      const leftoverRoles = await db
        .selectFrom('account_roles')
        .selectAll()
        .where('account_id', '=', account.id.value)
        .execute()

      expect(leftoverRoles).toEqual([])
    })

    it('eliminar una cuenta que ya no existe no falla (idempotente ante reintento)', async () => {
      await expect(
        repository.deleteById(AccountId.create('acc-jamas-existio')),
      ).resolves.toBeUndefined()
    })

    it('no impide que la cuenta se elimine mientras exista una solicitud de eliminacion asociada (FK desacoplada)', async () => {
      const account = buildAccount()
      await repository.save(account)

      await db
        .insertInto('account_deletion_requests')
        .values({
          id: `del-${account.id.value}`,
          account_id: account.id.value,
          status: 'IN_PROGRESS',
        })
        .execute()

      await repository.deleteById(account.id)

      expect(await repository.findById(account.id)).toBeNull()

      // La solicitud sobrevive: es la evidencia de que existio y cuando se
      // cerro, independientemente de que la cuenta ya no exista.
      const solicitud = await db
        .selectFrom('account_deletion_requests')
        .selectAll()
        .where('id', '=', `del-${account.id.value}`)
        .executeTakeFirst()

      expect(solicitud?.account_id).toBe(account.id.value)
    })
  })

  beforeEach(() => {
    repository = new PostgresAccountRepository(db)
  })
})
