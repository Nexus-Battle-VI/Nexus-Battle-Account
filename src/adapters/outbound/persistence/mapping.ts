import { AccountStatus } from '../../../domain/entities/AccountStatus'
import { isRole, type Role } from '../../../domain/entities/Role'
import type { AccountSnapshot } from '../../../domain/entities/Account'

/**
 * Traduccion entre filas de PostgreSQL y la instantanea del agregado.
 *
 * Vive aparte del repositorio y es **puro** a proposito: es la parte del
 * adaptador donde de verdad se puede equivocar uno, y sacarla del repositorio
 * permite probarla sin base de datos ni contenedor.
 */

export class PersistenceMappingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PersistenceMappingError'
  }
}

export interface AccountRow {
  readonly id: string
  readonly subject: string
  readonly email: string
  readonly display_name: string
  readonly status: string
}

const STATUSES: readonly string[] = Object.values(AccountStatus)

/**
 * Construye la instantanea a partir de la fila y sus roles.
 *
 * Valida lo que lee en lugar de confiar en la columna. Puede parecer excesivo
 * —la base de datos tiene sus propias restricciones— pero una fila escrita por
 * una version anterior del esquema, o por una migracion a medias, llegaria aqui
 * sin que nada la detuviera. Fallar al leerla es preferible a construir un
 * agregado con un estado que el dominio no reconoce.
 */
export const toSnapshot = (row: AccountRow, roles: readonly string[]): AccountSnapshot => {
  if (!STATUSES.includes(row.status)) {
    throw new PersistenceMappingError(
      `La cuenta ${row.id} tiene un estado desconocido: "${row.status}".`,
    )
  }

  const known: Role[] = []

  for (const role of roles) {
    if (!isRole(role)) {
      throw new PersistenceMappingError(`La cuenta ${row.id} tiene un rol desconocido: "${role}".`)
    }

    known.push(role)
  }

  if (known.length === 0) {
    // El agregado exige al menos un rol y `restore` lo rechazaria. Fallar aqui
    // senala el problema real —una fila sin roles— en lugar de un error del
    // dominio sobre datos que el dominio no escribio.
    throw new PersistenceMappingError(`La cuenta ${row.id} no tiene ningun rol almacenado.`)
  }

  return {
    id: row.id,
    subject: row.subject,
    email: row.email,
    displayName: row.display_name,
    status: row.status as AccountStatus,
    roles: known,
  }
}

/** Descompone la instantanea en la fila de `accounts`. */
export const toRow = (snapshot: AccountSnapshot): AccountRow => ({
  id: snapshot.id,
  subject: snapshot.subject,
  email: snapshot.email,
  display_name: snapshot.displayName,
  status: snapshot.status,
})
