import { Role } from '../entities/Role'
import { SanctionType } from '../entities/SanctionType'

export const SanctionPolicy = {
  canApply(actorRoles: ReadonlySet<Role>, sanctionType: SanctionType): boolean {
    if (actorRoles.has(Role.SuperAdministrator)) {
      return true
    }

    if (actorRoles.has(Role.Administrator)) {
      return true
    }

    if (actorRoles.has(Role.Moderator)) {
      return (
        sanctionType === SanctionType.Warning ||
        sanctionType === SanctionType.TemporarySuspension
      )
    }

    return false
  },
} as const