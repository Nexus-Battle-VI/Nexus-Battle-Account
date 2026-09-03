import PDFDocument from 'pdfkit'

import type {
  PdfPrivacyReportRendererPort,
  PrivacyReportSections,
} from '../../../application/ports/PdfPrivacyReportRendererPort'

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
    this.writeStatisticsSection(doc)
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

  /**
   * No existe todavia ningun dominio de heroes/estadisticas/progreso
   * desplegado en ningun servicio (`data-treatment-matrix-v0.3.md`,
   * "Pendiente asignacion de owner"). Se declara explicitamente asi, en
   * lugar de inventar una fuente que no existe.
   */
  private writeStatisticsSection(doc: PDFKit.PDFDocument): void {
    this.writeSectionHeading(doc, 'Estadísticas')
    this.writeUnavailableNotice(
      doc,
      'todavía no existe una fuente de datos de estadísticas del jugador en el sistema.',
    )
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
