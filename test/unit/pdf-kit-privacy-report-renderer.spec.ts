import { PdfKitPrivacyReportRenderer } from '../../src/adapters/outbound/export/PdfKitPrivacyReportRenderer'
import type { PrivacyReportSections } from '../../src/application/ports/PdfPrivacyReportRendererPort'

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

    await expect(new PdfKitPrivacyReportRenderer().render(sections)).resolves.toBeInstanceOf(Buffer)
  })

  it('no lanza cuando las secciones estan disponibles pero vacias (sin registros)', async () => {
    const sections: PrivacyReportSections = {
      ...BASE_SECTIONS,
      inventory: { available: true, items: [] },
      comments: { available: true, posts: [] },
      transactions: { available: true, orders: [] },
    }

    await expect(new PdfKitPrivacyReportRenderer().render(sections)).resolves.toBeInstanceOf(Buffer)
  })

  it('genera un PDF mas grande cuando hay mas contenido que describir', async () => {
    const vacio = await new PdfKitPrivacyReportRenderer().render({
      ...BASE_SECTIONS,
      inventory: { available: true, items: [] },
      comments: { available: true, posts: [] },
      transactions: { available: true, orders: [] },
    })
    const conDatos = await new PdfKitPrivacyReportRenderer().render(BASE_SECTIONS)

    // Prueba indirecta de que el contenido de cada seccion SI se escribe en
    // el documento: mas informacion produce un PDF de mayor tamano.
    expect(conDatos.length).toBeGreaterThan(vacio.length)
  })
})
