import { Role } from '../entities/Role'

/**
 * Reglas de asignacion de roles.
 *
 * Toda cuenta es jugador. Los roles elevados se acumulan sobre ese minimo, de
 * modo que retirar un rol elevado nunca deja una cuenta sin permisos basicos.
 */
export const RolePolicy = {
  /** Rol que recibe toda cuenta al registrarse. */
  baseRole: Role.Player,

  /** Un rol base no puede retirarse porque es el minimo de cualquier cuenta. */
  isRemovable(role: Role): boolean {
    return role !== Role.Player
  },

  /** Solo el Super Administrador raiz puede conceder o retirar roles. */
  canManageRoles(actorRoles: ReadonlySet<Role>): boolean {
    return actorRoles.has(Role.SuperAdministrator)
  },
} as const
