/**
 * Roles del control de acceso basado en roles.
 *
 * Se modela como objeto constante y union de tipos en lugar de `enum` para no
 * depender de sintaxis que genere codigo en tiempo de ejecucion, y para que el
 * conjunto de roles sea serializable de forma directa.
 */
export const Role = {
  Player: 'PLAYER',
  Moderator: 'MODERATOR',
  Administrator: 'ADMINISTRATOR',
  /**
   * Unico Super Administrador raiz del sistema (HU-02). No se crea mediante
   * HU-01, no se recupera mediante HU-04 y no existe una operacion publica que
   * lo genere. Vease HU-10 en el reporte de HU-02 para el tratamiento de
   * aprovisionamiento.
   */
  SuperAdministrator: 'SUPER_ADMINISTRATOR',
} as const

export type Role = (typeof Role)[keyof typeof Role]

export const ALL_ROLES: readonly Role[] = [
  Role.Player,
  Role.Moderator,
  Role.Administrator,
  Role.SuperAdministrator,
]

/** Roles que exigen segundo factor antes de completar la autenticacion (HU-02, CA-06). */
export const ADMINISTRATIVE_ROLES: readonly Role[] = [Role.Administrator, Role.SuperAdministrator]

export const isAdministrativeRole = (roles: Iterable<Role>): boolean => {
  for (const role of roles) {
    if (ADMINISTRATIVE_ROLES.includes(role)) {
      return true
    }
  }

  return false
}

export const isRole = (value: string): value is Role =>
  (ALL_ROLES as readonly string[]).includes(value)
