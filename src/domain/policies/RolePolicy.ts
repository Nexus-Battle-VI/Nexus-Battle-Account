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

  /**
   * Solo un administrador puede conceder o retirar roles.
   *
   * INCONSISTENCIA CONOCIDA (detectada durante HU-02, no corregida aqui): la
   * HU-39 vigente (Nexus-Battle-Management#27) exige que UNICAMENTE
   * SUPER_ADMINISTRATOR pueda crear cuentas Administrator/Moderator o
   * gestionar roles. Esta regla todavia permite a un Administrator gestionar
   * roles, lo que la HU-39 contradice. `grantRole`/`revokeRole` no los invoca
   * ningun caso de uso hoy (HU-02 solo LEE el rol vigente; no lo asigna), asi
   * que no hay una vulnerabilidad activa que corregir con el minimo cambio: no
   * se altera este comportamiento desde HU-02 para no invadir el alcance de
   * HU-39, que es quien debe redefinir esta regla formalmente.
   */
  canManageRoles(actorRoles: ReadonlySet<Role>): boolean {
    return actorRoles.has(Role.Administrator)
  },
} as const
