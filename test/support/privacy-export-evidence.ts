import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'

/** Lee los operadores TJ de PDFKit con su fuente estándar WinAnsi.
 * No es un validador PDF general ni comprueba la disposición visual.
 */
export const privacyPdfText = (pdf: Buffer): string => {
  const source = pdf.toString('latin1')
  const lines: string[] = []
  for (const match of source.matchAll(/\/Length (\d+)[\s\S]*?stream\r?\n/gu)) {
    const start = match.index + match[0].length
    const stream = pdf.subarray(start, start + Number(match[1]))
    const content = inflateSync(stream).toString('latin1')
    for (const text of content.matchAll(/\[([^\]]*)\]\s*TJ/gu)) {
      const hex = [...(text[1] ?? '').matchAll(/<([\da-f]+)>/giu)].map((part) => part[1]).join('')
      lines.push(new TextDecoder('windows-1252').decode(Buffer.from(hex, 'hex')))
    }
  }
  if (lines.length === 0) throw new Error('El PDF no contiene texto PDFKit legible.')

  return lines.join('\n').replace(/\s+/gu, ' ').trim()
}

/** Evidencia local optativa: únicamente fixtures sintéticos, sin testimonios. */
export const writePrivacyEvidence = (filename: string, content: string | Buffer): void => {
  if (process.env.HU45_WRITE_EVIDENCE !== '1') return
  const directory = join(process.cwd(), '.tmp', 'hu-45-5')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, filename), content)
}
