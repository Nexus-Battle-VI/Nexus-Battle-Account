import { PdfKitPrivacyReportRenderer } from '../../src/adapters/outbound/export/PdfKitPrivacyReportRenderer'
import type { PrivacyReportSections } from '../../src/application/ports/PdfPrivacyReportRendererPort'
import { privacyPdfText } from '../support/privacy-export-evidence'

const BASE_SECTIONS: PrivacyReportSections = {
  generatedAt: '2026-09-04T10:00:00.000Z',
  identity: {
    email: 'ana@nexus.test',
    displayName: 'Ana Ramirez',
    firstNames: 'Ana',
    lastNames: 'Ramirez',
    roles: ['PLAYER'],
    termsAccepted: true,
  },
  inventory: { available: true, items: [{ reference: 'espada', name: 'Espada', quantity: 1 }] },
  comments: {
    available: true,
    posts: [
      {
        id: 'post-1',
        threadId: 'thread-1',
        content: 'Hola',
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    ],
  },
  transactions: {
    available: true,
    orders: [{ id: 'ord-1', status: 'CONFIRMED', currency: 'COP', total: 1000, itemCount: 1 }],
  },
}

describe('PdfKitPrivacyReportRenderer (HU-45.3)', () => {
  it('produce un PDF valido (firma %PDF, EOF, tamano no trivial)', async () => {
    const buffer = await new PdfKitPrivacyReportRenderer().render(BASE_SECTIONS)

    expect(Buffer.isBuffer(buffer)).toBe(true)
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(buffer.toString('latin1')).toContain('%%EOF')
    expect(buffer.length).toBeGreaterThan(500)
  })

  it('no lanza cuando las tres secciones externas no estan disponibles', async () => {
    const sections: PrivacyReportSections = {
      ...BASE_SECTIONS,
      inventory: { available: false, items: [] },
      comments: { available: false, posts: [] },
      transactions: { available: false, orders: [] },
    }

    const text = privacyPdfText(await new PdfKitPrivacyReportRenderer().render(sections))
    expect(text).toContain(
      'Inventario Sección no disponible: no se pudo consultar el servicio de inventario',
    )
    expect(text).toContain(
      'Comentarios Sección no disponible: no se pudo consultar el servicio de comunidad',
    )
    expect(text).toContain(
      'Historial de transacciones Sección no disponible: no se pudo consultar el servicio de comercio',
    )
    expect(text).not.toContain('No tienes')
    expect(text).not.toContain('No has publicado')
  })

  it('no lanza cuando las secciones estan disponibles pero vacias (sin registros)', async () => {
    const sections: PrivacyReportSections = {
      ...BASE_SECTIONS,
      inventory: { available: true, items: [] },
      comments: { available: true, posts: [] },
      transactions: { available: true, orders: [] },
    }

    const text = privacyPdfText(await new PdfKitPrivacyReportRenderer().render(sections))
    expect(text).toContain('Inventario No tienes ítems en tu inventario.')
    expect(text).toContain('Comentarios No has publicado ningún comentario.')
    expect(text).toContain('Historial de transacciones No tienes pedidos registrados.')
  })

  it('escribe identidad y contenido de las fuentes, con Statistics explícitamente no disponible', async () => {
    const text = privacyPdfText(await new PdfKitPrivacyReportRenderer().render(BASE_SECTIONS))

    expect(text).toContain('Correo: ana@nexus.test')
    expect(text).toContain('Inventario')
    expect(text).toContain('Espada — cantidad: 1')
    expect(text).toContain('2026-08-01T00:00:00.000Z — Hola')
    expect(text).toContain('Historial de transacciones')
    expect(text).toContain('Pedido ord-1 — CONFIRMED — 1000 COP (1 artículos)')
    expect(text.split('Estadísticas ')[1]?.split(' Comentarios')[0]).toBe(
      'Sección no disponible: todavía no existe una fuente de datos de estadísticas del jugador en el sistema.',
    )
  })
})
