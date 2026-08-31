import type { AccountStatus } from '../../domain/entities/AccountStatus'
import { ALL_ROLES, type Role } from '../../domain/entities/Role'

export interface AdminAccountSummaryDto {
  readonly id: string
  readonly email: string
  readonly displayName: string
  readonly firstNames: string
  readonly lastNames: string
  readonly status: AccountStatus
  readonly roles: readonly Role[]
  readonly registeredAt: string
}

export interface AdminAccountStatusCountsDto {
  readonly pendingVerification: number
  readonly active: number
  readonly suspended: number
}

export interface AdminAccountListDto {
  readonly items: readonly AdminAccountSummaryDto[]
  readonly statusCounts: AdminAccountStatusCountsDto
}

export const orderAdminAccountRoles = (roles: Iterable<Role>): readonly Role[] => {
  const present = new Set(roles)

  return ALL_ROLES.filter((role) => present.has(role))
}
