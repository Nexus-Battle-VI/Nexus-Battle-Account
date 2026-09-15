/**
 * Archivo binario del reporte PDF (HU-45.3). Separado de `PrivacyExportFileDto`
 * -que usan JSON/XML- porque su `content` es texto: forzar bytes de PDF por
 * ese mismo campo de tipo `string` los corromperia al pasar por una
 * codificacion de texto.
 */
export interface PrivacyReportFileDto {
  readonly filename: string
  readonly mediaType: string
  readonly content: Buffer
}
