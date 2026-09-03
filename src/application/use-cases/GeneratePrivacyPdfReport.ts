import type { GetOwnPersonalData } from './GetOwnPersonalData'
import type { PlayerInventoryReportPort } from '../ports/PlayerInventoryReportPort'
import type { CommunityReportPort } from '../ports/CommunityReportPort'
import type { CommerceReportPort } from '../ports/CommerceReportPort'
import type { PdfPrivacyReportRendererPort } from '../ports/PdfPrivacyReportRendererPort'
import type { ClockPort } from '../ports/ClockPort'
import type { PrivacyReportFileDto } from '../dto/PrivacyReportFileDto'

export interface GeneratePrivacyPdfReportDependencies {
  readonly getOwnPersonalData: GetOwnPersonalData
  readonly inventory: PlayerInventoryReportPort
  readonly community: CommunityReportPort
  readonly commerce: CommerceReportPort
  readonly renderer: PdfPrivacyReportRendererPort
  readonly clock: ClockPort
}

/**
 * Reporte PDF de privacidad (HU-45.3, Management #135): identidad del
 * titular + inventario + comentarios + historial de transacciones.
 *
 * Cada fuente es una API PUBLICA de su propio bounded context -nunca acceso
 * directo a su base (ADR-014 Decision 4)-: el testimonio del titular se
 * reenvia sin modificar, y cada servicio resuelve SU PROPIA identidad desde
 * ese mismo testimonio, exactamente como resuelve la suya `GetOwnPersonalData`
 * aqui. Esta clase nunca ve ni construye un identificador de cuenta para
 * consultar otro servicio.
 *
 * Las tres fuentes se consultan en paralelo. Ninguna de ellas lanza: cada
 * puerto devuelve `available: false` cuando su servicio no responde, y el
 * reporte se genera igual, con esa seccion marcada como no disponible -nunca
 * como "sin registros", que afirmaria algo que no se sabe-. Un fallo de un
 * bounded context no bloquea las demas secciones ni el reporte completo.
 */
export class GeneratePrivacyPdfReport {
  private readonly deps: GeneratePrivacyPdfReportDependencies

  constructor(deps: GeneratePrivacyPdfReportDependencies) {
    this.deps = deps
  }

  async execute(subject: string, accessToken: string): Promise<PrivacyReportFileDto> {
    const identity = await this.deps.getOwnPersonalData.execute(subject)

    const [inventory, comments, transactions] = await Promise.all([
      this.deps.inventory.listOwnItems(accessToken),
      this.deps.community.listOwnPosts(accessToken),
      this.deps.commerce.listOwnOrders(accessToken),
    ])

    const content = await this.deps.renderer.render({
      generatedAt: this.deps.clock.now().toISOString(),
      identity,
      inventory,
      comments,
      transactions,
    })

    return {
      filename: 'nexus-battles-privacy-report.pdf',
      mediaType: 'application/pdf',
      content,
    }
  }
}
