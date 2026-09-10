import { PdfKitPrivacyReportRenderer } from '../../src/adapters/outbound/export/PdfKitPrivacyReportRenderer'
import type { PrivacyReportSections } from '../../src/application/ports/PdfPrivacyReportRendererPort'
import { privacyPdfText } from '../support/privacy-export-evidence'
import { preparedStatisticsFixture } from '../support/player-statistics-fixture'

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
  statistics: { available: true, statistics: preparedStatisticsFixture() },
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
  it('incluye las estadísticas base, efectivas y deltas del héroe preparado sin recalcular', async () => {
    const sections = {
      ...BASE_SECTIONS,
      statistics: { available: true as const, statistics: preparedStatisticsFixture() },
    }
    const before = structuredClone(sections)
    const text = privacyPdfText(await new PdfKitPrivacyReportRenderer().render(sections))
    expect(text).toContain('Estadísticas del héroe preparado')
    expect(text).toContain('Guerrera de Ana')
    expect(text).toContain('Poder: base 12; efectivo 16')
    expect(text).toContain('Vida: base 100; efectivo 100')
    expect(text).toContain('Defensa: base 8; efectivo 8')
    expect(text).toContain('Ataque: base 15; efectivo 15')
    expect(text).toContain('Daño: base 2d6; efectivo 2d6')
    expect(text).toContain('Sanación: base 3; efectivo 3')
    expect(text).toContain('Poder: 12 -> 16 (delta: 4)')
    expect(text).not.toContain('Sección no disponible')
    expect(sections).toEqual(before)
  })
  it('produce un PDF valido (firma %PDF, EOF, tamano no trivial)', async () => {
    const buffer = await new PdfKitPrivacyReportRenderer().render(BASE_SECTIONS)

    expect(Buffer.isBuffer(buffer)).toBe(true)
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(buffer.toString('latin1')).toContain('%%EOF')
    expect(buffer.length).toBeGreaterThan(500)
  })

  it('no lanza cuando las cuatro secciones externas no estan disponibles', async () => {
    const sections: PrivacyReportSections = {
      ...BASE_SECTIONS,
      inventory: { available: false, items: [] },
      statistics: { available: false, statistics: null },
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
    expect(text).toContain(
      'Estadísticas del héroe preparado Sección no disponible: no se pudieron consultar las estadísticas',
    )
    expect(text).not.toContain('No has publicado')
  })

  it('no lanza cuando las secciones estan disponibles pero vacias (sin registros)', async () => {
    const sections: PrivacyReportSections = {
      ...BASE_SECTIONS,
      inventory: { available: true, items: [] },
      statistics: { available: true, statistics: null },
      comments: { available: true, posts: [] },
      transactions: { available: true, orders: [] },
    }

    const text = privacyPdfText(await new PdfKitPrivacyReportRenderer().render(sections))
    expect(text).toContain('Inventario No tienes ítems en tu inventario.')
    expect(text).toContain('No hay una configuración de héroe preparado disponible')
    expect(text).not.toContain('Sección no disponible')
    expect(text).toContain('Comentarios No has publicado ningún comentario.')
    expect(text).toContain('Historial de transacciones No tienes pedidos registrados.')
  })

  it('escribe identidad y contenido de las cuatro fuentes disponibles', async () => {
    const text = privacyPdfText(await new PdfKitPrivacyReportRenderer().render(BASE_SECTIONS))

    expect(text).toContain('Correo: ana@nexus.test')
    expect(text).toContain('Inventario')
    expect(text).toContain('Espada — cantidad: 1')
    expect(text).toContain('2026-08-01T00:00:00.000Z — Hola')
    expect(text).toContain('Historial de transacciones')
    expect(text).toContain('Pedido ord-1 — CONFIRMED — 1000 COP (1 artículos)')
    expect(text).toContain('Guerrera de Ana')
    expect(text).not.toContain('Sección no disponible')
  })

  it('preserva null y porcentajes sin inventar ceros ni modificadores y muestra no listo', async () => {
    const stats = preparedStatisticsFixture()
    const values = {
      ...stats.baseStats,
      attack: null,
      damage: null,
      healing: { mode: 'PERCENTAGE' as const, basisPoints: 1250 },
    }
    const text = privacyPdfText(
      await new PdfKitPrivacyReportRenderer().render({
        ...BASE_SECTIONS,
        statistics: {
          available: true,
          statistics: {
            ...stats,
            baseStats: values,
            effectiveStats: values,
            deltas: [],
            ready: false,
          },
        },
      }),
    )
    expect(text).toContain('Preparación: no listo')
    expect(text).toContain('Ataque: base no informado; efectivo no informado')
    expect(text).toContain('Daño: base no informado; efectivo no informado')
    expect(text).toContain('Sanación: base 12.5%; efectivo 12.5%')
    expect(text).not.toContain('Modificadores')
  })
})
