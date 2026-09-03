/** Un ítem del inventario propio, tal como lo expone Player-Inventory (HU-27). */
export interface PlayerInventoryReportItem {
  readonly reference: string
  readonly name: string | null
  readonly quantity: number
}

/**
 * `available: false` significa que Player-Inventory no pudo consultarse en
 * este momento -no configurado, caído, o fallo de red-, nunca que el jugador
 * no tiene inventario. Esa distincion es la que permite al reporte decir
 * "sección no disponible" en lugar de afirmar, por error, "no tienes items".
 */
export interface PlayerInventoryReportResult {
  readonly available: boolean
  readonly items: readonly PlayerInventoryReportItem[]
}

/**
 * Puerto de lectura de inventario propio para el reporte PDF de HU-45.3.
 *
 * Es un puerto de SOLO LECTURA sobre la API publica de Player-Inventory -nunca
 * acceso directo a su base (ADR-014 Decision 4, `data-ownership.md`)-. El
 * testimonio del titular se reenvia tal cual: la identidad la resuelve
 * Player-Inventory con su propio `VerifiedIdentity.subject`, igual que
 * resuelve Account la suya.
 */
export interface PlayerInventoryReportPort {
  listOwnItems(accessToken: string): Promise<PlayerInventoryReportResult>
}

export const PLAYER_INVENTORY_REPORT = Symbol('PlayerInventoryReportPort')
