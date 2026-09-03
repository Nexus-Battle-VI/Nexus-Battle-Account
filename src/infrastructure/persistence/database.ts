import {
  Kysely,
  Migrator,
  PostgresDialect,
  type MigrationProvider,
  type MigrationResult,
} from 'kysely'
import { Pool } from 'pg'

import type { Database } from '../../adapters/outbound/persistence/schema'
import * as migration001 from '../../adapters/outbound/persistence/migrations/001-accounts'
import * as migrationHu01 from '../../adapters/outbound/persistence/migrations/hu01-registration'
import * as migrationHu02BlacklistSeed from '../../adapters/outbound/persistence/migrations/hu02-nickname-blacklist-seed'
import * as migrationHu03SuperAdmin from '../../adapters/outbound/persistence/migrations/hu03-super-administrator-role'
import * as migrationHu04RecoveryChallenges from '../../adapters/outbound/persistence/migrations/hu04-recovery-challenges'
import * as migrationHu33MfaEvidence from '../../adapters/outbound/persistence/migrations/hu33-mfa-evidence'
import * as migrationHu33MfaEvidenceMethod from '../../adapters/outbound/persistence/migrations/hu33-mfa-evidence-method'
import * as migrationHu43AccountDeletionRequests from '../../adapters/outbound/persistence/migrations/hu43-account-deletion-requests'
import * as migrationHu43DesvincularSolicitudEliminacion from '../../adapters/outbound/persistence/migrations/hu43-desvincular-solicitud-eliminacion-de-cuenta'

export interface DatabaseOptions {
  readonly connectionString: string
  /**
   * Conexiones simultaneas del pool.
   *
   * Deliberadamente bajo. Los seis servicios y los dos motores comparten
   * instancia (ADR-011): si cada servicio abriera un pool generoso, PostgreSQL
   * agotaria `max_connections` antes de que ningun servicio notara presion.
   */
  readonly maxConnections?: number
}

export const createDatabase = (options: DatabaseOptions): Kysely<Database> =>
  new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: options.connectionString,
        max: options.maxConnections ?? 5,
        // Cerrar conexiones ociosas devuelve capacidad al motor compartido.
        idleTimeoutMillis: 30_000,
        // Sin este limite, un motor caido deja las peticiones colgadas hasta el
        // tiempo de espera de la peticion HTTP, que es mucho mas largo.
        connectionTimeoutMillis: 5_000,
      }),
    }),
  })

/**
 * Migraciones declaradas en codigo, no descubiertas del sistema de ficheros.
 *
 * `FileMigrationProvider` leeria el directorio en tiempo de ejecucion, y en la
 * imagen de produccion ese directorio contiene JavaScript compilado con otra
 * ruta. Importarlas explicitamente hace que el compilador las verifique y que
 * el empaquetado no pueda dejarse ninguna fuera en silencio.
 *
 * EL NOMBRE DECIDE EL ORDEN, Y NO ES UN DETALLE COSMETICO. Kysely las ordena
 * alfabeticamente por esta clave y exige que las ya ejecutadas aparezcan en la
 * misma posicion que cuando se ejecutaron. Una migracion nueva cuyo nombre
 * quede ANTES que alguna ya aplicada no se aplica: el migrador aborta con
 * `corrupted migrations` y el servicio no arranca.
 *
 * Ocurrio. Las dos ultimas se llamaron `hardening-mfa-evidence*`, y
 * «hardening» va antes que «hu01» alfabeticamente. En una base vacia -CI,
 * portatil recien clonado- funcionaba; contra la base de produccion, que ya
 * tenia `hu01` a `hu04`, el arranque fallaba. Por eso llevan el prefijo de su
 * historia de usuario, como las demas: asi el orden del nombre coincide con el
 * orden en que se escribieron. `migrationNames` y su prueba lo vigilan.
 */
const migrations: MigrationProvider = {
  getMigrations: () =>
    Promise.resolve({
      '001-accounts': migration001,
      'hu01-registration': migrationHu01,
      'hu02-nickname-blacklist-seed': migrationHu02BlacklistSeed,
      'hu03-super-administrator-role': migrationHu03SuperAdmin,
      'hu04-recovery-challenges': migrationHu04RecoveryChallenges,
      'hu33-mfa-evidence': migrationHu33MfaEvidence,
      'hu33-mfa-evidence-method': migrationHu33MfaEvidenceMethod,
      'hu43-account-deletion-requests': migrationHu43AccountDeletionRequests,
      'hu43-desvincular-solicitud-eliminacion-de-cuenta':
        migrationHu43DesvincularSolicitudEliminacion,
    }),
}

/**
 * Los nombres de las migraciones, en el orden en que estan declaradas.
 *
 * Se expone para poder comprobar en una prueba que ese orden coincide con el
 * alfabetico, que es el unico que Kysely respeta. Sin esa comprobacion, el
 * error solo aparece al desplegar contra una base que ya tiene historial, y
 * para entonces el servicio ya no arranca.
 */
export const migrationNames = async (): Promise<readonly string[]> =>
  Object.keys(await migrations.getMigrations())

export interface MigrationOutcome {
  readonly applied: readonly string[]
  readonly error: unknown
}

/**
 * Lleva el esquema al ultimo estado conocido.
 *
 * No se ejecuta al arrancar el servicio: migrar desde el arranque significa que
 * varias replicas migran a la vez, y que un despliegue con una migracion rota
 * deja el servicio en bucle de reinicio. Se invoca desde `npm run migrate`,
 * como paso explicito del despliegue.
 */
export const migrateToLatest = async (db: Kysely<Database>): Promise<MigrationOutcome> => {
  const migrator = new Migrator({ db, provider: migrations })
  const { error, results } = await migrator.migrateToLatest()

  return {
    applied: (results ?? [])
      .filter((result: MigrationResult) => result.status === 'Success')
      .map((result: MigrationResult) => result.migrationName),
    error,
  }
}
