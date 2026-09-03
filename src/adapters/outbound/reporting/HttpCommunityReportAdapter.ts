import type {
  CommunityReportPort,
  CommunityReportPost,
  CommunityReportResult,
} from '../../../application/ports/CommunityReportPort'
import type { Logger } from '../../../infrastructure/observability/logger'

const REQUEST_TIMEOUT_MS = 5_000

const isPostArray = (value: unknown): value is CommunityReportPost[] =>
  Array.isArray(value) &&
  value.every(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as { id?: unknown }).id === 'string' &&
      typeof (entry as { content?: unknown }).content === 'string',
  )

/**
 * Lee los comentarios propios desde `GET /api/me/posts` de Community, para el
 * reporte PDF de HU-45.3.
 *
 * El testimonio del titular se reenvia sin modificar: Community resuelve SU
 * PROPIA identidad desde ese testimonio, igual que Account resuelve la suya.
 *
 * Nunca lanza: cualquier fallo se traduce en `available: false`.
 */
export class HttpCommunityReportAdapter implements CommunityReportPort {
  constructor(
    private readonly deps: {
      readonly baseUrl: string | null
      readonly logger: Logger
    },
  ) {}

  async listOwnPosts(accessToken: string): Promise<CommunityReportResult> {
    if (this.deps.baseUrl === null) {
      return { available: false, posts: [] }
    }

    try {
      const response = await fetch(`${this.deps.baseUrl}/api/me/posts`, {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })

      if (!response.ok) {
        this.deps.logger.warn('privacy_report_community_unavailable', { status: response.status })

        return { available: false, posts: [] }
      }

      const body: unknown = await response.json()

      if (!isPostArray(body)) {
        this.deps.logger.warn('privacy_report_community_unavailable', {
          reason: 'respuesta con forma inesperada',
        })

        return { available: false, posts: [] }
      }

      return { available: true, posts: body }
    } catch (error: unknown) {
      this.deps.logger.warn('privacy_report_community_unavailable', {
        reason: error instanceof Error ? error.message : 'fallo desconocido',
      })

      return { available: false, posts: [] }
    }
  }
}
