/** Proyección de lectura del contrato público de Player-Inventory, sin reglas de combate. */
export type ReportStatisticMagnitude =
  | { readonly mode: 'FIXED'; readonly amount: number }
  | { readonly mode: 'PERCENTAGE'; readonly basisPoints: number }
  | { readonly mode: 'DICE'; readonly count: number; readonly sides: number }

export interface ReportHeroStats {
  readonly power: number
  readonly health: number
  readonly defense: number
  readonly attack: number | null
  readonly damage: ReportStatisticMagnitude | null
  readonly healing: ReportStatisticMagnitude | null
}

export interface PreparedHeroStatistics {
  readonly hero: { readonly name: string; readonly reference: string }
  readonly baseStats: ReportHeroStats
  readonly effectiveStats: ReportHeroStats
  readonly deltas: readonly {
    readonly statistic: string
    readonly base: number
    readonly effective: number
    readonly delta: number
  }[]
  readonly ready: boolean
}

/** Una consulta exitosa sin configuración propia se distingue de un fallo técnico. */
export type PlayerStatisticsReportResult =
  | { readonly available: true; readonly statistics: PreparedHeroStatistics | null }
  | { readonly available: false; readonly statistics: null }

/** Solo lectura. Reenvía el access token; no admite selectores de titular o héroe.
 * Los fallos remotos se representan con available: false, sin lanzar.
 */
export interface PlayerStatisticsReportPort {
  getOwnPreparedHeroStatistics(accessToken: string): Promise<PlayerStatisticsReportResult>
}

export const PLAYER_STATISTICS_REPORT = Symbol('PlayerStatisticsReportPort')
