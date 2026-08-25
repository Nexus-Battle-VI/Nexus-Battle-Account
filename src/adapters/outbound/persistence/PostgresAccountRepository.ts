import type { Kysely } from 'kysely'

import { Account } from '../../../domain/entities/Account'
import { AccountId } from '../../../domain/value-objects/AccountId'
import { DisplayName } from '../../../domain/value-objects/DisplayName'
import { EmailAddress } from '../../../domain/value-objects/EmailAddress'
import type { AccountRepositoryPort } from '../../../application/ports/AccountRepositoryPort'
import type { AccountSnapshot } from '../../../domain/entities/Account'
import type { Database } from './schema'
import { toRow, toSnapshot } from './mapping'

/**
 * Repositorio del agregado Account sobre PostgreSQL, con Kysely.
 *
 * Cada consulta esta escrita a la vista. No hay carga perezosa que pueda
 * disparar consultas dentro de un bucle sin que aparezcan en el codigo, que es
 * la razon por la que ADR-012 eligio un constructor de consultas y no un ORM.
 */
export class PostgresAccountRepository implements AccountRepositoryPort {
  private readonly db: Kysely<Database>

  constructor(db: Kysely<Database>) {
    this.db = db
  }

  /**
   * Guarda el agregado entero, cuenta y roles, en una sola transaccion.
   *
   * Los roles se reemplazan por completo en lugar de calcular diferencias: el
   * agregado es la autoridad sobre su conjunto de roles, y un borrado seguido
   * de una insercion expresa exactamente eso. Sin transaccion, un fallo entre
   * ambas operaciones dejaria una cuenta SIN NINGUN ROL, que es un estado que
   * el dominio no admite y que ni siquiera se podria volver a leer.
   */
  async save(account: Account): Promise<void> {
    const snapshot = account.toSnapshot()
    const row = toRow(snapshot)

    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('accounts')
        .values(row)
        .onConflict((oc) =>
          oc.column('id').doUpdateSet({
            subject: row.subject,
            email: row.email,
            display_name: row.display_name,
            status: row.status,
            updated_at: new Date(),
          }),
        )
        .execute()

      await trx.deleteFrom('account_roles').where('account_id', '=', snapshot.id).execute()

      await trx
        .insertInto('account_roles')
        .values(snapshot.roles.map((role) => ({ account_id: snapshot.id, role })))
        .execute()
    })
  }

  async findById(id: AccountId): Promise<Account | null> {
    const row = await this.db
      .selectFrom('accounts')
      .selectAll()
      .where('id', '=', id.value)
      .executeTakeFirst()

    return row === undefined ? null : await this.hydrate(row)
  }

  async findByEmail(email: EmailAddress): Promise<Account | null> {
    const row = await this.db
      .selectFrom('accounts')
      .selectAll()
      .where('email', '=', email.value)
      .executeTakeFirst()

    return row === undefined ? null : await this.hydrate(row)
  }

  async findBySubject(subject: string): Promise<Account | null> {
    const row = await this.db
      .selectFrom('accounts')
      .selectAll()
      .where('subject', '=', subject)
      .executeTakeFirst()

    return row === undefined ? null : await this.hydrate(row)
  }

  /**
   * Comprueba la existencia sin traerse la fila.
   *
   * `select 1` en lugar de `selectAll`: el caso de uso solo necesita saber si
   * existe, y leer columnas que nadie va a mirar es trabajo que la base de datos
   * hace para nada.
   */
  async existsByEmail(email: EmailAddress): Promise<boolean> {
    const found = await this.db
      .selectFrom('accounts')
      .select((eb) => eb.lit(1).as('uno'))
      .where('email', '=', email.value)
      .executeTakeFirst()

    return found !== undefined
  }

  /**
   * Reconstituye el agregado a partir de la fila y sus roles.
   *
   * Son dos consultas y no un `join` deliberadamente: un `join` devolveria la
   * cuenta repetida una vez por rol, y habria que deduplicarla en memoria. Con
   * un agregado que se lee de uno en uno, dos consultas simples son mas claras
   * y no mas caras.
   */
  private async hydrate(row: AccountSnapshotRow): Promise<Account> {
    const roles = await this.db
      .selectFrom('account_roles')
      .select('role')
      .where('account_id', '=', row.id)
      .execute()

    const snapshot: AccountSnapshot = toSnapshot(
      row,
      roles.map((entry) => entry.role),
    )

    return Account.restore({
      id: AccountId.create(snapshot.id),
      subject: snapshot.subject,
      email: EmailAddress.create(snapshot.email),
      displayName: DisplayName.create(snapshot.displayName),
      status: snapshot.status,
      roles: snapshot.roles,
    })
  }
}

interface AccountSnapshotRow {
  readonly id: string
  readonly subject: string
  readonly email: string
  readonly display_name: string
  readonly status: string
}
