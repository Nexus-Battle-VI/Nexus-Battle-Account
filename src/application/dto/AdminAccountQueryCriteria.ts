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
}
