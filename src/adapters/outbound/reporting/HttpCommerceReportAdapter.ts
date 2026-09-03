import type {
  CommerceReportOrder,
  CommerceReportPort,
  CommerceReportResult,
} from '../../../application/ports/CommerceReportPort'
import type { Logger } from '../../../infrastructure/observability/logger'

const REQUEST_TIMEOUT_MS = 5_000

const isOrderArray = (value: unknown): value is CommerceReportOrder[] =>
  Array.isArray(value) &&
  value.every(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as { id?: unknown }).id === 'string' &&
      typeof (entry as { status?: unknown }).status === 'string',
  )

/**
 * Lee el historial de pedidos propio desde `GET /api/orders` de Commerce,
 * para el reporte PDF de HU-45.3 (RF-45, Politica §9).
 *
 * El testimonio del titular se reenvia sin modificar: Commerce resuelve SU
 * PROPIA identidad desde ese testimonio (`identity.subject`, sin parametro
 * `customerId`), igual que Account resuelve la suya.
 *
 * Nunca lanza: cualquier fallo se traduce en `available: false`.
 */
export class HttpCommerceReportAdapter implements CommerceReportPort {
  constructor(
    private readonly deps: {
      readonly baseUrl: string | null
      readonly logger: Logger
    },
  ) {}

  async listOwnOrders(accessToken: string): Promise<CommerceReportResult> {
    if (this.deps.baseUrl === null) {
      return { available: false, orders: [] }
    }

    try {
      const response = await fetch(`${this.deps.baseUrl}/api/orders`, {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })

      if (!response.ok) {
        this.deps.logger.warn('privacy_report_commerce_unavailable', { status: response.status })

        return { available: false, orders: [] }
      }

      const body: unknown = await response.json()

      if (!isOrderArray(body)) {
        this.deps.logger.warn('privacy_report_commerce_unavailable', {
          reason: 'respuesta con forma inesperada',
        })

        return { available: false, orders: [] }
      }

      return { available: true, orders: body }
    } catch (error: unknown) {
      this.deps.logger.warn('privacy_report_commerce_unavailable', {
        reason: error instanceof Error ? error.message : 'fallo desconocido',
      })

      return { available: false, orders: [] }
    }
  }
}
