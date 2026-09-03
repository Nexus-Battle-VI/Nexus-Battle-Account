/** Un comentario propio, tal como lo expone Community (`GET /me/posts`). */
export interface CommunityReportPost {
  readonly id: string
  readonly threadId: string
  readonly content: string
  readonly createdAt: string
}

/** `available: false`: Community no pudo consultarse, no que el titular no comento nunca. */
export interface CommunityReportResult {
  readonly available: boolean
  readonly posts: readonly CommunityReportPost[]
}

/**
 * Puerto de lectura de comentarios propios para el reporte PDF de HU-45.3.
 *
 * Solo lectura sobre la API publica de Community (`GET /me/posts`, ya
 * implementado). Nunca acceso directo a su base.
 */
export interface CommunityReportPort {
  listOwnPosts(accessToken: string): Promise<CommunityReportResult>
}

export const COMMUNITY_REPORT = Symbol('CommunityReportPort')
