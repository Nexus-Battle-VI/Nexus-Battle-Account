import type { Account } from '../../domain/entities/Account'
import type { AccountId } from '../../domain/value-objects/AccountId'
import type { EmailAddress } from '../../domain/value-objects/EmailAddress'
import type { DisplayName } from '../../domain/value-objects/DisplayName'

export interface HashedSecurityAnswer {
  readonly questionId: string
  readonly answerHash: string
}

/**
 * Puerto de persistencia del agregado Account.
 *
 * Account es propietario exclusivo de sus datos. Ningun otro servicio accede a
 * este almacen, ni directamente ni mediante claves foraneas.
 *
 * Hay dos adaptadores, y `PERSISTENCE_DRIVER` elige cual opera:
 * `PostgresAccountRepository` sobre PostgreSQL (ADR-012) y el de memoria.
 *
 * El de memoria NO es un resto del andamiaje: es el que permite que las pruebas
 * del dominio y de los casos de uso corran sin Docker. Ambos cumplen el mismo
 * contrato, incluido el de no filtrar al almacen una mutacion sin guardar.
 */
export interface AccountRepositoryPort {
  save(account: Account): Promise<void>
  findById(id: AccountId): Promise<Account | null>
  findByEmail(email: EmailAddress): Promise<Account | null>

  /**
   * Recupera la cuenta vinculada a un sujeto del proveedor de identidad.
   *
   * Es la consulta que responde "cual es MI cuenta" a partir del testimonio,
   * sin que quien pregunta tenga que conocer ningun identificador interno.
   */
  findBySubject(subject: string): Promise<Account | null>

  /**
   * Recupera la cuenta por su apodo (HU-02, login con identificador = apodo).
   *
   * Comparacion insensible a mayusculas, igual que `existsByDisplayName`: es
   * la misma semantica de unicidad ya aprobada en HU-01, no una nueva regla de
   * normalizacion. En PostgreSQL reutiliza el indice unico
   * `accounts_display_name_ci` creado en la migracion de HU-01.
   */
  findByDisplayName(displayName: DisplayName): Promise<Account | null>

  existsByEmail(email: EmailAddress): Promise<boolean>
  existsByDisplayName(displayName: DisplayName): Promise<boolean>

  /**
   * Persiste la cuenta, sus roles y las respuestas de seguridad en un unico
   * paso coherente. Las implementaciones PostgreSQL lo hacen en transaccion.
   */
  saveRegistration(account: Account, answers: readonly HashedSecurityAnswer[]): Promise<void>

  /** Hashes de las respuestas de HU-01. Vacio si la cuenta no las tiene. */
  findSecurityAnswers(id: AccountId): Promise<readonly HashedSecurityAnswer[]>

  /**
   * Elimina fisicamente la cuenta (HU-43.3): nombres, apellidos, apodo,
   * correo, metadatos de avatar, `terms_accepted`, `status` y marcas
   * temporales dejan de existir. Los roles y las respuestas de seguridad se
   * eliminan en cascada al mismo tiempo (restriccion `on delete cascade` de
   * `hu01-registration` y `001-accounts`).
   *
   * Idempotente: eliminar una cuenta que ya no existe -un reintento tras un
   * fallo que ocurrio DESPUES de borrarla- no falla, simplemente no afecta
   * ninguna fila.
   */
  deleteById(id: AccountId): Promise<void>
}

export const ACCOUNT_REPOSITORY = Symbol('AccountRepositoryPort')
