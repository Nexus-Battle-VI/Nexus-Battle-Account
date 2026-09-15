import type {
  PlayerStatisticsReportPort,
  PlayerStatisticsReportResult,
  PreparedHeroStatistics,
  ReportHeroStats,
  ReportStatisticMagnitude,
} from '../../../application/ports/PlayerStatisticsReportPort'
import type { Logger } from '../../../infrastructure/observability/logger'

const REQUEST_TIMEOUT_MS = 5_000
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const isMagnitude = (value: unknown): value is ReportStatisticMagnitude | null => {
  if (value === null) return true
  if (!isRecord(value)) return false
  switch (value.mode) {
    case 'FIXED':
      return isNumber(value.amount)
    case 'PERCENTAGE':
      return isNumber(value.basisPoints)
    case 'DICE':
      return isNumber(value.count) && isNumber(value.sides)
    default:
      return false
  }
}

const isStats = (value: unknown): value is ReportHeroStats =>
  isRecord(value) &&
  isNumber(value.power) &&
  isNumber(value.health) &&
  isNumber(value.defense) &&
  (value.attack === null || isNumber(value.attack)) &&
  isMagnitude(value.damage) &&
  isMagnitude(value.healing)

const isDelta = (value: unknown): value is PreparedHeroStatistics['deltas'][number] =>
  isRecord(value) &&
  typeof value.statistic === 'string' &&
  isNumber(value.base) &&
  isNumber(value.effective) &&
  isNumber(value.delta)

/** Valida únicamente la proyección consumida, sin copiar el dominio Hero ni recalcular HU-28. */
const readStatistics = (body: unknown): PreparedHeroStatistics | null => {
  if (!isRecord(body) || !isRecord(body.configuration) || !isRecord(body.readiness)) return null
  const { hero, baseStats, effectiveStats, deltas } = body.configuration
  if (
    !isRecord(hero) ||
    typeof hero.name !== 'string' ||
    typeof hero.reference !== 'string' ||
    !isStats(baseStats) ||
    !isStats(effectiveStats) ||
    !Array.isArray(deltas) ||
    !deltas.every(isDelta) ||
    typeof body.readiness.ready !== 'boolean'
  )
    return null

  return {
    hero: { name: hero.name, reference: hero.reference },
    baseStats,
    effectiveStats,
    deltas,
    ready: body.readiness.ready,
  }
}

/** Consulta self-service de la configuración preparada. No realiza escrituras ni selecciona héroes. */
export class HttpPlayerStatisticsReportAdapter implements PlayerStatisticsReportPort {
  constructor(
    private readonly deps: { readonly baseUrl: string | null; readonly logger: Logger },
  ) {}

  async getOwnPreparedHeroStatistics(accessToken: string): Promise<PlayerStatisticsReportResult> {
    if (this.deps.baseUrl === null) return { available: false, statistics: null }

    try {
      const response = await fetch(`${this.deps.baseUrl}/api/inventories/me/heroes/selection`, {
        method: 'GET',
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: 'error',
      })
      // La fuente usa 404 tanto sin selección como cuando el héroe ya no pertenece al titular.
      if (response.status === 404) return { available: true, statistics: null }
      if (!response.ok) {
        this.deps.logger.warn('privacy_report_statistics_unavailable', { status: response.status })
        return { available: false, statistics: null }
      }

      const body: unknown = await response.json()
      const statistics = readStatistics(body)
      if (statistics === null) {
        this.deps.logger.warn('privacy_report_statistics_unavailable', {
          reason: 'invalid_response',
        })
        return { available: false, statistics: null }
      }
      return { available: true, statistics }
    } catch {
      // Los errores de red pueden contener datos del request; no se registran sus mensajes.
      this.deps.logger.warn('privacy_report_statistics_unavailable', { reason: 'request_failed' })
      return { available: false, statistics: null }
    }
  }
}
