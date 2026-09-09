import type { AccountStatus } from '../../domain/entities/AccountStatus'
import type { Role } from '../../domain/entities/Role'

export interface AdminAccountQueryCriteria {
  readonly id?: string
  readonly email?: string
  readonly firstNames?: string
  readonly lastNames?: string
  readonly displayName?: string
  readonly role?: Role
  readonly status?: AccountStatus
  /** Existencia de sanciones recibidas, incluidas las vencidas; omitido no filtra. */
  readonly hasSanctionHistory?: boolean
  /** Limites opcionales e inclusivos del instante de registro, en UTC. */
  readonly registeredFrom?: Date
  readonly registeredTo?: Date
}
