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
  readonly first_names: string
  readonly last_names: string
  readonly terms_accepted: boolean
  readonly avatar_storage_key: string
  readonly avatar_mime_type: string
  readonly avatar_size_bytes: number
  readonly avatar_original_name: string
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
    throw new PersistenceMappingError(`La cuenta ${row.id} no tiene ningun rol almacenado.`)
  }

  return {
    id: row.id,
    subject: row.subject,
    email: row.email,
    displayName: row.display_name,
    firstNames: row.first_names,
    lastNames: row.last_names,
    termsAccepted: row.terms_accepted,
    avatarStorageKey: row.avatar_storage_key,
    avatarMimeType: row.avatar_mime_type,
    avatarSizeBytes: row.avatar_size_bytes,
    avatarOriginalName: row.avatar_original_name,
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
  first_names: snapshot.firstNames,
  last_names: snapshot.lastNames,
  terms_accepted: snapshot.termsAccepted,
  avatar_storage_key: snapshot.avatarStorageKey,
  avatar_mime_type: snapshot.avatarMimeType,
  avatar_size_bytes: snapshot.avatarSizeBytes,
  avatar_original_name: snapshot.avatarOriginalName,
  status: snapshot.status,
})
