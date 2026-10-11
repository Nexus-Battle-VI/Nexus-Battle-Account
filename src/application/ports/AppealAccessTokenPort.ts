/**
 * Token de alcance limitado para que una cuenta suspendida o baneada pueda
 * apelar sin recuperar acceso general (HU-42, §6 del cierre de HU-42:
 * "identidad restringida").
 *
 * NO es un segundo emisor de JWT de sesion (ADR-004 ya decide que Account no
 * compite con Cognito en eso). Es un credencial opaco, de un solo proposito,
 * que SOLO el `AppealAccessGuard` de este mismo servicio reconoce: ningun
 * otro servicio (Combat, Catalog, ...) lo aceptaria si se le presentara,
 * porque ninguno comparte el secreto ni la forma de verificarlo. Por eso
 * puede emitirse incluso para una cuenta banneada sin reabrirle inventario,
 * comercio, comentarios ni combate.
 */
export interface AppealAccessTokenPayload {
  readonly accountId: string
  readonly subject: string
}

export interface AppealAccessTokenPort {
  issue(payload: AppealAccessTokenPayload, expiresInSeconds: number): string
  /** `null` si el token es invalido, esta vencido o fue alterado. */
  verify(token: string): AppealAccessTokenPayload | null
}

export const APPEAL_ACCESS_TOKEN = Symbol('AppealAccessTokenPort')
