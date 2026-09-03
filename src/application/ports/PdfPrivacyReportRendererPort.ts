import type { OwnPersonalDataDto } from '../dto/OwnPersonalDataDto'
import type { PlayerInventoryReportResult } from './PlayerInventoryReportPort'
import type { CommunityReportResult } from './CommunityReportPort'
import type { CommerceReportResult } from './CommerceReportPort'

/**
 * Las cuatro secciones que RF-45/HU-45.3 exigen en el reporte PDF, mas la
 * identidad del titular. `statistics` no lleva datos: no existe todavia
 * ningun dominio de heroes/estadisticas/progreso desplegado en ningun
 * servicio (`data-treatment-matrix-v0.3.md`, "Pendiente asignacion de
 * owner"). La seccion se declara explicitamente no disponible en el PDF, en
 * lugar de inventar una fuente que no existe.
 */
export interface PrivacyReportSections {
  readonly generatedAt: string
  readonly identity: OwnPersonalDataDto
  readonly inventory: PlayerInventoryReportResult
  readonly comments: CommunityReportResult
  readonly transactions: CommerceReportResult
}

export interface PdfPrivacyReportRendererPort {
  render(sections: PrivacyReportSections): Promise<Buffer>
}

export const PDF_PRIVACY_REPORT_RENDERER = Symbol('PdfPrivacyReportRendererPort')
