import 'reflect-metadata'

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { Kysely } from 'kysely'

import {
  createDatabase,
  describeError,
  migrateToLatest,
} from '../../src/infrastructure/persistence/database'
import { PostgresAccountRepository } from '../../src/adapters/outbound/persistence/PostgresAccountRepository'
import type { Database } from '../../src/adapters/outbound/persistence/schema'
import { Account } from '../../src/domain/entities/Account'
import { AccountId } from '../../src/domain/value-objects/AccountId'
import { DisplayName } from '../../src/domain/value-objects/DisplayName'
import { EmailAddress } from '../../src/domain/value-objects/EmailAddress'
import { Role } from '../../src/domain/entities/Role'
import { AccountStatus } from '../../src/domain/entities/AccountStatus'

/**
 * Adaptador de PostgreSQL contra un motor REAL, en contenedor.
 *
 * Estas pruebas viven aparte de la suite por defecto porque necesitan Docker.
 * Lo que comprueban no se puede comprobar de otra forma: que el SQL sea valido,
 * que las restricciones existan de verdad y que la transaccion haga lo que dice.
 * Un doble de prueba habria pasado con un esquema equivocado.
 */
describe('PostgresAccountRepository', () => {
  let container: StartedPostgreSqlContainer
  let db: Kysely<Database>
  let repository: PostgresAccountRepository

  const AT = new Date('2026-08-25T10:00:00.000Z')
  let contador = 0

  const buildAccount = (): Account => {
    contador += 1

    return Account.register({
      id: AccountId.create(`acc-${String(contador)}`),
      subject: `sujeto-${String(contador)}`,
      email: EmailAddress.create(`persona${String(contador)}@nexus.test`),
      displayName: DisplayName.create('Ana Ramirez'),
      occurredAt: AT,
    })
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start()
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

  it('recupera por correo y por sujeto', async () => {
    const account = buildAccount()
    await repository.save(account)

    const porCorreo = await repository.findByEmail(account.currentEmail)
    const porSujeto = await repository.findBySubject(account.subject)

    expect(porCorreo?.id.value).toBe(account.id.value)
    expect(porSujeto?.id.value).toBe(account.id.value)
  })

  it('devuelve null cuando no existe', async () => {
    expect(await repository.findById(AccountId.create('acc-inexistente'))).toBeNull()
    expect(await repository.findBySubject('sujeto-inexistente')).toBeNull()
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

    account.grantRole(Role.Moderator, new Set([Role.Administrator]))

    const found = await repository.findById(account.id)

    expect(found?.currentRoles).toEqual([Role.Player])
  })

  it('actualiza la cuenta existente en lugar de duplicarla', async () => {
    const account = buildAccount()
    await repository.save(account)

    account.verify(AT)
    account.grantRole(Role.Moderator, new Set([Role.Administrator]))
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
   * Los roles se reemplazan por completo: el agregado es la autoridad sobre su
   * conjunto. Retirar uno tiene que borrarlo de verdad, no dejarlo huerfano.
   */
  it('retira los roles que el agregado ya no tiene', async () => {
    const account = buildAccount()
    account.grantRole(Role.Moderator, new Set([Role.Administrator]))
    await repository.save(account)

    account.revokeRole(Role.Moderator, new Set([Role.Administrator]))
    await repository.save(account)

    const roles = await db
      .selectFrom('account_roles')
      .select('role')
      .where('account_id', '=', account.id.value)
      .execute()

    expect(roles.map((r) => r.role)).toEqual([Role.Player])
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

  it('la migracion es idempotente: volver a aplicarla no cambia nada', async () => {
    const { applied, error } = await migrateToLatest(db)

    expect(error).toBeUndefined()
    expect(applied).toEqual([])
  })

  beforeEach(() => {
    repository = new PostgresAccountRepository(db)
  })
})
