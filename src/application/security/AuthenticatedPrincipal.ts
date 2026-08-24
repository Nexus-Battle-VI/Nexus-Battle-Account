/**
 * Principal de cuenta ya autenticado por una capa externa confiable.
 *
 * La autenticacion ocurre fuera del caso de uso: accountId debe provenir de un
 * mecanismo confiable y no de datos arbitrarios enviados por frontend.
 */
export interface AuthenticatedPrincipal {
  readonly accountId: string
}
