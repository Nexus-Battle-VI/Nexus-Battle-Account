import type { Role } from '../../domain/entities/Role'

/**
 * Refleja en el proveedor de identidad los roles que Account decide.
 *
 * **La direccion importa y es de un solo sentido.** La fuente de verdad de los
 * roles es Account: viven en `account_roles`, en PostgreSQL. El proveedor no
 * decide nada; solo se le informa, para que el rol viaje dentro del testimonio
 * y los otros servicios puedan leerlo sin preguntarle a Account en cada
 * peticion. Es exactamente lo que el modulo de Terraform del pool ya declara:
 * "la fuente de verdad de los roles sigue siendo Account: aqui solo se refleja
 * la pertenencia para que viaje en el testimonio".
 *
 * Sin este puerto habia dos fuentes de verdad que nadie sincronizaba. Account
 * escribia `PLAYER` en PostgreSQL y el testimonio viajaba sin `cognito:groups`,
 * de modo que los otros servicios veian a esa persona **sin ningun rol**. Hoy
 * eso no rompe nada porque ninguna puerta pide `PLAYER` -todas piden
 * `ADMINISTRATOR` o `MODERATOR`- y por eso la divergencia era invisible: no
 * habria dado sintoma hasta que alguien escribiera `@Roles(Role.Player)`, y ese
 * dia el sintoma seria "los usuarios nuevos no pueden hacer nada" sin ninguna
 * pista que apuntara aqui.
 *
 * Este puerto NO crea ni borra identidades. Account dejo de hacer eso
 * (`IdentityRequiredError`): el sujeto ya existe cuando esto se invoca.
 */
export interface RoleDirectoryPort {
  /**
   * Deja la pertenencia del sujeto igual a `roles`.
   *
   * Es **idempotente por contrato**: invocarlo dos veces con los mismos roles
   * tiene el mismo efecto que invocarlo una. De eso depende que un reintento
   * de registro sea seguro.
   *
   * Un adaptador solo debe tocar los grupos que corresponden a un rol conocido.
   * Si alguien creo a mano un grupo ajeno al vocabulario de roles, no es asunto
   * de Account retirarlo: reflejar no es apropiarse del pool.
   */
  reflect(subject: string, roles: readonly Role[]): Promise<void>
}

/**
 * El reflejo no se pudo completar.
 *
 * Se distingue de cualquier error de dominio a proposito: significa "no se sabe
 * si el proveedor quedo al dia", no "los roles son invalidos". Quien lo reciba
 * debe **fallar cerrado**. Dar por buena una cuenta cuyo rol no viaja es
 * precisamente el defecto que este puerto existe para impedir.
 */
export class RoleDirectoryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RoleDirectoryError'
  }
}

export const ROLE_DIRECTORY = Symbol('RoleDirectoryPort')
