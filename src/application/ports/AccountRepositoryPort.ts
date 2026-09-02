import type { Account } from '../../domain/entities/Account'
import type { AccountId } from '../../domain/value-objects/AccountId'
import type { EmailAddress } from '../../domain/value-objects/EmailAddress'
import type { DisplayName } from '../../domain/value-objects/DisplayName'

export interface HashedSecurityAnswer {
  readonly questionId: string
  readonly answerHash: string
}

/**
 * Evidencia de consentimiento versionado (EN-011, CA-02): que version de la
 * Politica acepto la cuenta y cuando. `acceptedAt` SIEMPRE lo genera Account
 * via `ClockPort` -nunca un valor recibido de Web-, porque es el backend, no
 * el cliente, quien da fe de cuando ocurrio la manifestacion.
 *
 * No lleva IP, User-Agent, ubicacion, device id, ni ningun otro dato de
 * contexto: CA-02 exige poder demostrar QUE version se acepto y CUANDO, no
 * reconstruir la sesion completa de quien acepto.
 */
export interface PrivacyConsentRecord {
  /**
   * Identificador tecnico de la fila, generado por `IdGeneratorPort` igual
   * que el de la cuenta. Existe solo porque el registro es append-only y no
   * hay clave natural: no es un identificador de dominio que nadie consulte.
   */
  readonly id: string
  readonly policyVersion: string
  readonly acceptedAt: Date
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
   * Persiste la cuenta, sus roles, las respuestas de seguridad y el
   * consentimiento de privacidad (EN-011) en un unico paso coherente. Las
   * implementaciones PostgreSQL lo hacen en transaccion: si algo falla, no
   * queda una cuenta guardada sin su evidencia de consentimiento, ni al reves.
   *
   * `consent` es opcional en la FIRMA del puerto -no en `RegisterAccount`, que
   * SIEMPRE lo construye- para poder seguir sembrando cuentas de prueba sin
   * consentimiento en el resto de la suite, y porque modela con exactitud el
   * caso real de una cuenta anterior a este cambio: sin evidencia versionada
   * historica, tal como exige la migracion (no se fabrica retroactivamente).
   */
  saveRegistration(
    account: Account,
    answers: readonly HashedSecurityAnswer[],
    consent?: PrivacyConsentRecord,
  ): Promise<void>

  /** Hashes de las respuestas de HU-01. Vacio si la cuenta no las tiene. */
  findSecurityAnswers(id: AccountId): Promise<readonly HashedSecurityAnswer[]>

  /**
   * Historial COMPLETO de consentimientos de la cuenta, ordenado del mas
   * antiguo al mas reciente. Append-only: aceptar una version nueva anade una
   * fila, nunca sobrescribe ni borra la anterior (EN-011, ADR-014 Decision 1).
   */
  findPrivacyConsents(id: AccountId): Promise<readonly PrivacyConsentRecord[]>
}

export const ACCOUNT_REPOSITORY = Symbol('AccountRepositoryPort')
