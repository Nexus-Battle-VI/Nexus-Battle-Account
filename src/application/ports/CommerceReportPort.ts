/** Un pedido propio, tal como lo expone Commerce (`GET /orders`). */
export interface CommerceReportOrder {
  readonly id: string
  readonly status: string
  readonly currency: string
  readonly total: number
  readonly itemCount: number
}

/** `available: false`: Commerce no pudo consultarse, no que el titular no tenga pedidos. */
export interface CommerceReportResult {
  readonly available: boolean
  readonly orders: readonly CommerceReportOrder[]
}

/**
 * Puerto de lectura de historial de transacciones propio para el reporte PDF
 * de HU-45.3 (RF-45, Política §9).
 *
 * Solo lectura sobre la API publica de Commerce (`GET /orders`, ya
 * implementado, sin parametro `customerId`). Nunca acceso directo a su base.
 */
export interface CommerceReportPort {
  listOwnOrders(accessToken: string): Promise<CommerceReportResult>
}

export const COMMERCE_REPORT = Symbol('CommerceReportPort')
