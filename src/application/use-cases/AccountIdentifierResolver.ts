import type { Account } from '../../domain/entities/Account'
import { DisplayName } from '../../domain/value-objects/DisplayName'
import { EmailAddress } from '../../domain/value-objects/EmailAddress'
import type { AccountRepositoryPort } from '../ports/AccountRepositoryPort'

/**
 * Resuelve el identificador de login (HU-02) a una cuenta, sin que quien
 * llama sepa si el valor era un correo o un apodo.
 *
 * La deteccion de formato reutiliza `EmailAddress.create` y `DisplayName.create`
 * -las mismas validaciones ya aprobadas en HU-01- en lugar de una expresion
 * regular nueva. Esto evita dos cosas a la vez: inventar una segunda
 * normalizacion de apodo, y que Web tenga que decidir "esto es un correo o un
 * apodo" y convertirlo -esa traduccion es responsabilidad del backend
 * precisamente para no filtrar informacion de la cuenta al cliente.
 *
 * Un identificador que no tiene forma de correo NI de apodo valido no llega a
 * consultar el repositorio: no existe ninguna cuenta que pudiera tener ese
 * valor, y evitar la consulta es, ademas, una comparacion menos para quien
 * esta tanteando el sistema.
 */
export const resolveAccountByIdentifier = async (
  accounts: AccountRepositoryPort,
  identifier: string,
): Promise<Account | null> => {
  try {
    return await accounts.findByEmail(EmailAddress.create(identifier))
  } catch {
    // No tiene forma de correo. Se intenta como apodo a continuacion.
  }

  try {
    return await accounts.findByDisplayName(DisplayName.create(identifier))
  } catch {
    return null
  }
}
