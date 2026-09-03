import type { Generated } from 'kysely'
import type { SecondFactorMethod } from '../../../domain/entities/SecondFactorMethod'

/**
 * Esquema de la base de datos de Account, tipado para Kysely.
 *
 * **Es la unica fuente de verdad de los tipos de persistencia.** No hay paso de
 * generacion de codigo ni fichero de esquema en otro lenguaje: lo que se
 * declara aqui es lo que el compilador verifica en cada consulta. Si una
 * migracion anade una columna y esta interfaz no la refleja, el codigo que la
 * use no compila.
 *
 * Los nombres de columna son `snake_case`, que es la convencion de PostgreSQL.
 * La traduccion a la instantanea del agregado ocurre en `mapping.ts`, y ocurre
 * de forma explicita: no hay conversion automatica de nombres que pueda
 * sorprender.
 */
export interface AccountsTable {
  readonly id: string

  /**
   * Sujeto en el proveedor de identidad. Es el vinculo con el testimonio.
   *
   * Lleva restriccion de unicidad porque dos cuentas con el mismo sujeto harian
   * ambigua la pregunta "cual es MI cuenta".
   */
  readonly subject: string

  /**
   * El dominio ya normaliza el correo a minusculas en `EmailAddress`, asi que
   * una restriccion de unicidad simple basta. La base de datos es la ultima
   * linea, no la primera.
   */
  readonly email: string

  readonly display_name: string
  readonly first_names: string
  readonly last_names: string
  readonly terms_accepted: boolean
  readonly avatar_storage_key: string
  readonly avatar_mime_type: string
  readonly avatar_size_bytes: number
  readonly avatar_original_name: string
  readonly status: string
  readonly created_at: Generated<Date>
  readonly updated_at: Generated<Date>
}

/**
 * Roles de la cuenta, en su propia tabla.
 *
 * Se normaliza en lugar de guardar un array porque permite que la base de datos
 * **valide el vocabulario** con una restriccion: un rol inventado no llega a
 * escribirse. Con una columna de array esa comprobacion viviria solo en el
 * codigo.
 *
 * La clave foranea apunta a `accounts`, que es del MISMO servicio. La
 * prohibicion del proyecto es sobre claves foraneas ENTRE servicios.
 */
export interface AccountRolesTable {
  readonly account_id: string
  readonly role: string
}

export interface SecurityQuestionsTable {
  readonly id: string
  readonly statement: string
  readonly active: boolean
}

export interface AccountSecurityAnswersTable {
  readonly account_id: string
  readonly question_id: string
  readonly answer_hash: string
  readonly created_at: Generated<Date>
}

export interface NicknameBlacklistEntriesTable {
  readonly id: string
  readonly term: string
  readonly active: boolean
  readonly created_at: Generated<Date>
  readonly updated_at: Generated<Date>
}

/**
 * Proceso temporal de recuperacion de contrasena (HU-04, TASK HU-04.2).
 *
 * `account_id` es nullable a proposito: `StartPasswordRecovery` crea el
 * desafio exista o no la cuenta, para no permitir enumerar correos
 * registrados por la respuesta del primer paso. `code_hash` tambien es
 * nullable: el desafio nace en `IDENTIFIED`, antes de que exista un codigo
 * que resumir. El codigo en claro nunca tiene columna: no se persiste.
 */
export interface RecoveryChallengesTable {
  readonly token: string
  readonly email: string
  readonly account_id: string | null
  readonly stage: string
  readonly code_hash: string | null
  readonly created_at: Generated<Date>
}

/**
 * Evidencia de que un testimonio de acceso concreto nacio de un segundo factor.
 * La clave es `(subject, jti)`: la prueba muere con el testimonio que la origino.
 */
export interface MfaEvidencesTable {
  readonly subject: string
  readonly jti: string
  readonly method: SecondFactorMethod
  readonly expires_at: Date
  readonly verified_at: Generated<Date>
}

/**
 * Solicitud durable de eliminacion de cuenta (HU-43.1). Vive enteramente
 * dentro de Account (ADR-014 Decision 5): ningun progreso "por bounded
 * context" se persiste aqui porque esa orquestacion no existe.
 */
export interface AccountDeletionRequestsTable {
  readonly id: string
  readonly account_id: string
  readonly status: string
  readonly received_at: Generated<Date>
  readonly closed_at: Date | null
  /**
   * Correo de destino de la notificacion de cierre (HU-43.3/HU-43.4),
   * capturado en la recepcion. Anadido por la migracion
   * `hu43-account-deletion-requests-notify-email`: HU-43.1 no lo necesitaba
   * porque todavia no ejecutaba tratamiento ni notificaba nada.
   */
  readonly notify_email: string
}

export interface Database {
  readonly accounts: AccountsTable
  readonly account_roles: AccountRolesTable
  readonly security_questions: SecurityQuestionsTable
  readonly account_security_answers: AccountSecurityAnswersTable
  readonly nickname_blacklist_entries: NicknameBlacklistEntriesTable
  readonly recovery_challenges: RecoveryChallengesTable
  readonly mfa_evidences: MfaEvidencesTable
  readonly account_deletion_requests: AccountDeletionRequestsTable
}
