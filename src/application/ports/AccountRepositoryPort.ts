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
 * La implementacion definitiva sobre PostgreSQL queda sujeta a ADR-005, que
 * decide el ORM u ODM. En Foundation opera un adaptador en memoria real.
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
  existsByEmail(email: EmailAddress): Promise<boolean>
  existsByDisplayName(displayName: DisplayName): Promise<boolean>

  /**
   * Persiste la cuenta, sus roles y las respuestas de seguridad en un unico
   * paso coherente. Las implementaciones PostgreSQL lo hacen en transaccion.
   */
  saveRegistration(account: Account, answers: readonly HashedSecurityAnswer[]): Promise<void>
}

export const ACCOUNT_REPOSITORY = Symbol('AccountRepositoryPort')
