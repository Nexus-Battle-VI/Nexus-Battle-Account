import type { OwnPersonalDataDto } from '../../src/application/dto/OwnPersonalDataDto'
import type { ClockPort } from '../../src/application/ports/ClockPort'
import type { PlayerInventoryReportResult } from '../../src/application/ports/PlayerInventoryReportPort'
import type { CommunityReportResult } from '../../src/application/ports/CommunityReportPort'
import type { CommerceReportResult } from '../../src/application/ports/CommerceReportPort'
import type { PrivacyReportSections } from '../../src/application/ports/PdfPrivacyReportRendererPort'
import { GeneratePrivacyPdfReport } from '../../src/application/use-cases/GeneratePrivacyPdfReport'
import type { GetOwnPersonalData } from '../../src/application/use-cases/GetOwnPersonalData'

const FIXED_NOW = new Date('2026-09-04T10:00:00.000Z')
const FIXED_CLOCK: ClockPort = { now: () => new Date(FIXED_NOW) }

const PERSONAL_DATA: OwnPersonalDataDto = {
  email: 'ana@nexus.test',
  displayName: 'Ana Ramirez',
  firstNames: 'Ana',
  lastNames: 'Ramirez',
  roles: ['PLAYER'],
  termsAccepted: true,
}

const AVAILABLE_INVENTORY: PlayerInventoryReportResult = {
  available: true,
  items: [{ reference: 'espada-de-hierro', name: 'Espada de Hierro', quantity: 1 }],
}
const AVAILABLE_COMMENTS: CommunityReportResult = {
  available: true,
  posts: [
    { id: 'post-1', threadId: 'thread-1', content: 'Hola', createdAt: '2026-08-01T00:00:00.000Z' },
  ],
}
const AVAILABLE_ORDERS: CommerceReportResult = {
  available: true,
  orders: [{ id: 'ord-1', status: 'CONFIRMED', currency: 'COP', total: 1000, itemCount: 1 }],
}

interface Harness {
  readonly getOwnPersonalData: { execute: jest.Mock }
  readonly inventory: { listOwnItems: jest.Mock }
  readonly community: { listOwnPosts: jest.Mock }
  readonly commerce: { listOwnOrders: jest.Mock }
  readonly renderer: { render: jest.Mock }
  readonly useCase: GeneratePrivacyPdfReport
}

const buildHarness = (): Harness => {
  const getOwnPersonalData = { execute: jest.fn().mockResolvedValue(PERSONAL_DATA) }
  const inventory = { listOwnItems: jest.fn().mockResolvedValue(AVAILABLE_INVENTORY) }
  const community = { listOwnPosts: jest.fn().mockResolvedValue(AVAILABLE_COMMENTS) }
  const commerce = { listOwnOrders: jest.fn().mockResolvedValue(AVAILABLE_ORDERS) }
  const renderer = { render: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')) }

  const useCase = new GeneratePrivacyPdfReport({
    getOwnPersonalData: getOwnPersonalData as unknown as GetOwnPersonalData,
    inventory: inventory,
    community: community,
    commerce: commerce,
    renderer: renderer,
    clock: FIXED_CLOCK,
  })

  return { getOwnPersonalData, inventory, community, commerce, renderer, useCase }
}

describe('GeneratePrivacyPdfReport (HU-45.3)', () => {
  it('agrega identidad, inventario, comentarios y transacciones, y devuelve el PDF resultante', async () => {
    const harness = buildHarness()

    const file = await harness.useCase.execute('sub:ana', 'token-de-ana')

    expect(file).toEqual({
      filename: 'nexus-battles-privacy-report.pdf',
      mediaType: 'application/pdf',
      content: Buffer.from('%PDF-1.4 fake'),
    })

    const sections = harness.renderer.render.mock.calls[0]?.[0] as PrivacyReportSections
    expect(sections.generatedAt).toBe(FIXED_NOW.toISOString())
    expect(sections.identity).toEqual(PERSONAL_DATA)
    expect(sections.inventory).toEqual(AVAILABLE_INVENTORY)
    expect(sections.comments).toEqual(AVAILABLE_COMMENTS)
    expect(sections.transactions).toEqual(AVAILABLE_ORDERS)
  })

  it('reenvia el MISMO testimonio del titular a las tres fuentes, sin construir ningun identificador de cuenta', async () => {
    const harness = buildHarness()

    await harness.useCase.execute('sub:ana', 'token-de-ana')

    expect(harness.inventory.listOwnItems).toHaveBeenCalledWith('token-de-ana')
    expect(harness.community.listOwnPosts).toHaveBeenCalledWith('token-de-ana')
    expect(harness.commerce.listOwnOrders).toHaveBeenCalledWith('token-de-ana')
  })

  it('consulta identidad y resuelve el subject ANTES de tocar cualquier fuente externa', async () => {
    const harness = buildHarness()

    await harness.useCase.execute('sub:ana', 'token-de-ana')

    expect(harness.getOwnPersonalData.execute).toHaveBeenCalledWith('sub:ana')
  })

  it('propaga el error si el subject no resuelve ninguna cuenta, sin llamar a ninguna fuente externa', async () => {
    const harness = buildHarness()
    harness.getOwnPersonalData.execute.mockRejectedValue(new Error('cuenta inexistente'))

    await expect(harness.useCase.execute('sub:fantasma', 'token')).rejects.toThrow(
      'cuenta inexistente',
    )

    expect(harness.inventory.listOwnItems).not.toHaveBeenCalled()
    expect(harness.community.listOwnPosts).not.toHaveBeenCalled()
    expect(harness.commerce.listOwnOrders).not.toHaveBeenCalled()
  })

  it('genera el reporte igual cuando una fuente no esta disponible: no bloquea las demas secciones', async () => {
    const harness = buildHarness()
    harness.inventory.listOwnItems.mockResolvedValue({ available: false, items: [] })

    const file = await harness.useCase.execute('sub:ana', 'token-de-ana')

    expect(file.filename).toBe('nexus-battles-privacy-report.pdf')
    const sections = harness.renderer.render.mock.calls[0]?.[0] as PrivacyReportSections
    expect(sections.inventory).toEqual({ available: false, items: [] })
    // Las otras dos secciones siguen presentes con sus datos reales.
    expect(sections.comments).toEqual(AVAILABLE_COMMENTS)
    expect(sections.transactions).toEqual(AVAILABLE_ORDERS)
  })

  it('genera el reporte incluso cuando las TRES fuentes externas no estan disponibles', async () => {
    const harness = buildHarness()
    harness.inventory.listOwnItems.mockResolvedValue({ available: false, items: [] })
    harness.community.listOwnPosts.mockResolvedValue({ available: false, posts: [] })
    harness.commerce.listOwnOrders.mockResolvedValue({ available: false, orders: [] })

    const file = await harness.useCase.execute('sub:ana', 'token-de-ana')

    expect(file.mediaType).toBe('application/pdf')
    expect(harness.renderer.render).toHaveBeenCalledTimes(1)
  })

  it('no altera los datos de origen al ejecutar la generación', async () => {
    const harness = buildHarness()
    const before = structuredClone([
      PERSONAL_DATA,
      AVAILABLE_INVENTORY,
      AVAILABLE_COMMENTS,
      AVAILABLE_ORDERS,
    ])

    await harness.useCase.execute('sub:ana', 'token-de-ana')

    expect([PERSONAL_DATA, AVAILABLE_INVENTORY, AVAILABLE_COMMENTS, AVAILABLE_ORDERS]).toEqual(
      before,
    )
  })

  it('ownership: sus dependencias no incluyen ningun puerto de escritura ni de otro dato de Account', () => {
    const harness = buildHarness()
    const deps = (harness.useCase as unknown as { deps: Record<string, unknown> }).deps

    expect(Object.keys(deps).sort()).toEqual([
      'clock',
      'commerce',
      'community',
      'getOwnPersonalData',
      'inventory',
      'renderer',
    ])
  })
})
