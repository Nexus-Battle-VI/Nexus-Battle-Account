/**
 * Identidad ya autenticada por un mecanismo externo al caso de uso.
 *
 * No contiene roles: la autorizacion debe consultar los roles vigentes de
 * Account para no confiar en datos enviados por el llamador o en permisos
 * obsoletos.
 */
export interface AuthenticatedPrincipal {
  readonly accountId: string
}
