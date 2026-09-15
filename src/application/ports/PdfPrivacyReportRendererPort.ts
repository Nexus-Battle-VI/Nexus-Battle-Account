import type { OwnPersonalDataDto } from '../dto/OwnPersonalDataDto'
import type { PlayerInventoryReportResult } from './PlayerInventoryReportPort'
import type { CommunityReportResult } from './CommunityReportPort'
import type { CommerceReportResult } from './CommerceReportPort'
import type { PlayerStatisticsReportResult } from './PlayerStatisticsReportPort'

/**
 * Las cuatro secciones que RF-45/HU-45.3 exigen en el reporte PDF, mas la
 * identidad del titular. Statistics representa la configuración preparada
 * propia publicada por Player-Inventory; Account no calcula estadísticas.
 */
export interface PrivacyReportSections {
  readonly generatedAt: string
  readonly identity: OwnPersonalDataDto
  readonly inventory: PlayerInventoryReportResult
  readonly statistics: PlayerStatisticsReportResult
  readonly comments: CommunityReportResult
  readonly transactions: CommerceReportResult
}

export interface PdfPrivacyReportRendererPort {
  render(sections: PrivacyReportSections): Promise<Buffer>
}

export const PDF_PRIVACY_REPORT_RENDERER = Symbol('PdfPrivacyReportRendererPort')
