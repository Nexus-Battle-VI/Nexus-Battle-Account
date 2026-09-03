import type {
  PlayerInventoryReportItem,
  PlayerInventoryReportPort,
  PlayerInventoryReportResult,
} from '../../../application/ports/PlayerInventoryReportPort'
import type { Logger } from '../../../infrastructure/observability/logger'

/** Tope defensivo de paginas: evita un bucle sin fin si el servicio remoto informara un total incoherente. */
const MAX_PAGES = 10
const REQUEST_TIMEOUT_MS = 5_000

interface InventoryItemsPage {
  readonly items: readonly { itemId: string; quantity: number; product: { name: string } | null }[]
  readonly page: number
  readonly totalPages: number
}

const isInventoryItemsPage = (value: unknown): value is InventoryItemsPage =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as { items?: unknown }).items) &&
  typeof (value as { totalPages?: unknown }).totalPages === 'number'

/**
 * Lee el inventario propio desde `GET /api/inventories/me/items` de
 * Player-Inventory, para el reporte PDF de HU-45.3.
 *
 * El testimonio del titular se reenvia sin modificar: Player-Inventory
 * resuelve SU PROPIA identidad desde ese testimonio (`identity.subject`),
 * igual que hace Account con el suyo. Esta clase nunca construye ni conoce
 * un identificador de cuenta para pedir el inventario de otra persona.
 *
 * Nunca lanza: cualquier fallo -sin `baseUrl` configurada, red, timeout,
 * respuesta no exitosa- se traduce en `available: false`, para que el
 * reporte pueda generarse igual con esta seccion marcada como no disponible.
 */
export class HttpPlayerInventoryReportAdapter implements PlayerInventoryReportPort {
  constructor(
    private readonly deps: {
      readonly baseUrl: string | null
      readonly logger: Logger
    },
  ) {}

  async listOwnItems(accessToken: string): Promise<PlayerInventoryReportResult> {
    if (this.deps.baseUrl === null) {
      return { available: false, items: [] }
    }

    const items: PlayerInventoryReportItem[] = []

    try {
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const response = await fetch(
          `${this.deps.baseUrl}/api/inventories/me/items?page=${String(page)}`,
          {
            headers: { authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          },
        )

        if (!response.ok) {
          this.deps.logger.warn('privacy_report_inventory_unavailable', { status: response.status })

          return { available: false, items: [] }
        }

        const body: unknown = await response.json()

        if (!isInventoryItemsPage(body)) {
          this.deps.logger.warn('privacy_report_inventory_unavailable', {
            reason: 'respuesta con forma inesperada',
          })

          return { available: false, items: [] }
        }

        for (const item of body.items) {
          items.push({
            reference: item.itemId,
            name: item.product?.name ?? null,
            quantity: item.quantity,
          })
        }

        if (page >= body.totalPages) {
          break
        }
      }

      return { available: true, items }
    } catch (error: unknown) {
      this.deps.logger.warn('privacy_report_inventory_unavailable', {
        reason: error instanceof Error ? error.message : 'fallo desconocido',
      })

      return { available: false, items: [] }
    }
  }
}
