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
} as const

export type Role = (typeof Role)[keyof typeof Role]

export const ALL_ROLES: readonly Role[] = [Role.Player, Role.Moderator, Role.Administrator]

export const isRole = (value: string): value is Role =>
  (ALL_ROLES as readonly string[]).includes(value)
