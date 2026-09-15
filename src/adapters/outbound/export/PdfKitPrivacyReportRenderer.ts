import PDFDocument from 'pdfkit'
import type {
  ReportHeroStats,
  ReportStatisticMagnitude,
} from '../../../application/ports/PlayerStatisticsReportPort'

import type {
  PdfPrivacyReportRendererPort,
  PrivacyReportSections,
} from '../../../application/ports/PdfPrivacyReportRendererPort'

const STATISTIC_LABELS: Readonly<Record<string, string>> = {
  POWER: 'Poder',
  HEALTH: 'Vida',
  DEFENSE: 'Defensa',
  ATTACK: 'Ataque',
  DAMAGE: 'Daño',
  HEALING: 'Sanación',
}

const statisticText = (value: number | ReportStatisticMagnitude | null): string => {
  if (value === null) return 'no informado'
  if (typeof value === 'number') return String(value)
  switch (value.mode) {
    case 'FIXED':
      return String(value.amount)
    case 'PERCENTAGE':
      return `${String(value.basisPoints / 100)}%`
    case 'DICE':
      return `${String(value.count)}d${String(value.sides)}`
  }
}

/**
 * Renderiza el reporte PDF de HU-45.3 con `pdfkit` (generacion en servidor,
 * sin dependencias nativas). Es el UNICO lugar que conoce la biblioteca de
 * PDF: el caso de uso y los puertos de lectura no saben que el reporte
 * termina siendo un PDF.
 *
 * Solo describe lo que RF-45 exige -identidad y las cuatro secciones-, sin
 * afirmar nada que las fuentes no confirmaron: una seccion no disponible se
 * marca como tal, nunca como "sin registros".
 */
export class PdfKitPrivacyReportRenderer implements PdfPrivacyReportRendererPort {
  render(sections: PrivacyReportSections): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 })
      const chunks: Buffer[] = []

      doc.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })
      doc.on('end', () => {
        resolve(Buffer.concat(chunks))
      })
      doc.on('error', (error: Error) => {
        reject(error)
      })

      this.writeContent(doc, sections)
      doc.end()
    })
  }

  private writeContent(doc: PDFKit.PDFDocument, sections: PrivacyReportSections): void {
    doc.fontSize(18).text('Nexus Battles VI — Reporte de privacidad', { align: 'left' })
    doc
      .fontSize(9)
      .fillColor('#555555')
      .text(`Generado el ${sections.generatedAt}`)
      .fillColor('#000000')
    doc.moveDown(1.5)

    doc.fontSize(13).text('Identidad del titular')
    doc.moveDown(0.3)
    doc
      .fontSize(10)
      .text(`Apodo: ${sections.identity.displayName}`)
      .text(`Correo: ${sections.identity.email}`)
      .text(`Nombre: ${sections.identity.firstNames} ${sections.identity.lastNames}`)
    doc.moveDown(1)

    this.writeInventorySection(doc, sections)
    this.writeStatisticsSection(doc, sections)
    this.writeCommentsSection(doc, sections)
    this.writeTransactionsSection(doc, sections)
  }

  private writeSectionHeading(doc: PDFKit.PDFDocument, title: string): void {
    doc.fontSize(13).text(title)
    doc.moveDown(0.3)
  }

  private writeUnavailableNotice(doc: PDFKit.PDFDocument, detail: string): void {
    doc
      .fontSize(10)
      .fillColor('#8a1f11')
      .text(`Sección no disponible: ${detail}`)
      .fillColor('#000000')
    doc.moveDown(1)
  }

  private writeInventorySection(doc: PDFKit.PDFDocument, sections: PrivacyReportSections): void {
    this.writeSectionHeading(doc, 'Inventario')

    if (!sections.inventory.available) {
      this.writeUnavailableNotice(
        doc,
        'no se pudo consultar el servicio de inventario en este momento.',
      )

      return
    }

    if (sections.inventory.items.length === 0) {
      doc.fontSize(10).text('No tienes ítems en tu inventario.')
    } else {
      for (const item of sections.inventory.items) {
        doc
          .fontSize(10)
          .text(`• ${item.name ?? item.reference} — cantidad: ${String(item.quantity)}`)
      }
    }

    doc.moveDown(1)
  }

  private writeStatisticsSection(doc: PDFKit.PDFDocument, sections: PrivacyReportSections): void {
    this.writeSectionHeading(doc, 'Estadísticas del héroe preparado')
    if (!sections.statistics.available) {
      this.writeUnavailableNotice(
        doc,
        'no se pudieron consultar las estadísticas en Player-Inventory en este momento.',
      )
      return
    }
    const data = sections.statistics.statistics
    if (data === null) {
      doc
        .fontSize(10)
        .text('No hay una configuración de héroe preparado disponible para consultar estadísticas.')
      doc.moveDown(1)
      return
    }
    doc.fontSize(10).text(`Héroe: ${data.hero.name} (${data.hero.reference})`)
    doc.text(`Preparación: ${data.ready ? 'listo' : 'no listo'}`)
    doc.text('Estadísticas base y efectivas')
    const keys: readonly (keyof ReportHeroStats)[] = [
      'power',
      'health',
      'defense',
      'attack',
      'damage',
      'healing',
    ]
    for (const key of keys) {
      doc.text(
        `${STATISTIC_LABELS[key.toUpperCase()] ?? key}: base ${statisticText(data.baseStats[key])}; efectivo ${statisticText(data.effectiveStats[key])}`,
      )
    }
    if (data.deltas.length > 0) {
      doc.text('Modificadores (deltas informados por la fuente)')
      for (const change of data.deltas) {
        doc.text(
          `${STATISTIC_LABELS[change.statistic] ?? change.statistic}: ${String(change.base)} -> ${String(change.effective)} (delta: ${String(change.delta)})`,
        )
      }
    }
    doc.moveDown(1)
  }

  private writeCommentsSection(doc: PDFKit.PDFDocument, sections: PrivacyReportSections): void {
    this.writeSectionHeading(doc, 'Comentarios')

    if (!sections.comments.available) {
      this.writeUnavailableNotice(
        doc,
        'no se pudo consultar el servicio de comunidad en este momento.',
      )

      return
    }

    if (sections.comments.posts.length === 0) {
      doc.fontSize(10).text('No has publicado ningún comentario.')
    } else {
      for (const post of sections.comments.posts) {
        doc.fontSize(10).text(`• ${post.createdAt} — ${post.content}`)
      }
    }

    doc.moveDown(1)
  }

  private writeTransactionsSection(doc: PDFKit.PDFDocument, sections: PrivacyReportSections): void {
    this.writeSectionHeading(doc, 'Historial de transacciones')

    if (!sections.transactions.available) {
      this.writeUnavailableNotice(
        doc,
        'no se pudo consultar el servicio de comercio en este momento.',
      )

      return
    }

    if (sections.transactions.orders.length === 0) {
      doc.fontSize(10).text('No tienes pedidos registrados.')
    } else {
      for (const order of sections.transactions.orders) {
        doc
          .fontSize(10)
          .text(
            `• Pedido ${order.id} — ${order.status} — ${String(order.total)} ${order.currency} (${String(order.itemCount)} artículos)`,
          )
      }
    }

    doc.moveDown(1)
  }
}
