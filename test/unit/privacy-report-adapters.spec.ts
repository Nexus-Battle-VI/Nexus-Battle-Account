import { HttpPlayerInventoryReportAdapter } from '../../src/adapters/outbound/reporting/HttpPlayerInventoryReportAdapter'
import { HttpCommunityReportAdapter } from '../../src/adapters/outbound/reporting/HttpCommunityReportAdapter'
import { HttpCommerceReportAdapter } from '../../src/adapters/outbound/reporting/HttpCommerceReportAdapter'
import { createLogger } from '../../src/infrastructure/observability/logger'

const silentLogger = createLogger({
  level: 'error',
  service: 'test',
  version: '0.0.0',
  sink: () => undefined,
})

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

afterEach(() => {
  jest.restoreAllMocks()
})

describe('HttpPlayerInventoryReportAdapter (HU-45.3)', () => {
  it('sin baseUrl configurada, la seccion es no disponible sin llamar a fetch', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch')
    const adapter = new HttpPlayerInventoryReportAdapter({ baseUrl: null, logger: silentLogger })

    const result = await adapter.listOwnItems('token')

    expect(result).toEqual({ available: false, items: [] })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('recupera el inventario propio reenviando el testimonio del titular', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        items: [
          { itemId: 'espada-de-hierro', quantity: 2, product: { name: 'Espada de Hierro' } },
          { itemId: 'referencia-desconocida', quantity: 1, product: null },
        ],
        page: 1,
        totalPages: 1,
      }),
    )
    const adapter = new HttpPlayerInventoryReportAdapter({
      baseUrl: 'http://inventory:3002',
      logger: silentLogger,
    })

    const result = await adapter.listOwnItems('token-de-ana')

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://inventory:3002/api/inventories/me/items?page=1',
      expect.objectContaining({ headers: { authorization: 'Bearer token-de-ana' } }),
    )
    expect(result).toEqual({
      available: true,
      items: [
        { reference: 'espada-de-hierro', name: 'Espada de Hierro', quantity: 2 },
        { reference: 'referencia-desconocida', name: null, quantity: 1 },
      ],
    })
  })

  it('recorre todas las paginas hasta agotar totalPages', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse(200, {
          items: [{ itemId: 'item-1', quantity: 1, product: null }],
          page: 1,
          totalPages: 2,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          items: [{ itemId: 'item-2', quantity: 1, product: null }],
          page: 2,
          totalPages: 2,
        }),
      )
    const adapter = new HttpPlayerInventoryReportAdapter({
      baseUrl: 'http://inventory:3002',
      logger: silentLogger,
    })

    const result = await adapter.listOwnItems('token')

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(result.items.map((item) => item.reference)).toEqual(['item-1', 'item-2'])
  })

  it('no disponible cuando el servicio responde con un error', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(500, { message: 'caido' }))
    const adapter = new HttpPlayerInventoryReportAdapter({
      baseUrl: 'http://inventory:3002',
      logger: silentLogger,
    })

    expect(await adapter.listOwnItems('token')).toEqual({ available: false, items: [] })
  })

  it('no disponible cuando la red falla, sin lanzar', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
    const adapter = new HttpPlayerInventoryReportAdapter({
      baseUrl: 'http://inventory:3002',
      logger: silentLogger,
    })

    await expect(adapter.listOwnItems('token')).resolves.toEqual({ available: false, items: [] })
  })

  it('no disponible cuando la respuesta tiene una forma inesperada', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(200, { inesperado: true }))
    const adapter = new HttpPlayerInventoryReportAdapter({
      baseUrl: 'http://inventory:3002',
      logger: silentLogger,
    })

    expect(await adapter.listOwnItems('token')).toEqual({ available: false, items: [] })
  })
})

describe('HttpCommunityReportAdapter (HU-45.3)', () => {
  it('sin baseUrl configurada, la seccion es no disponible sin llamar a fetch', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch')
    const adapter = new HttpCommunityReportAdapter({ baseUrl: null, logger: silentLogger })

    expect(await adapter.listOwnPosts('token')).toEqual({ available: false, posts: [] })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('recupera los comentarios propios reenviando el testimonio del titular', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(200, [
        {
          id: 'post-1',
          threadId: 'thread-1',
          content: 'Hola',
          createdAt: '2026-08-01T00:00:00.000Z',
        },
      ]),
    )
    const adapter = new HttpCommunityReportAdapter({
      baseUrl: 'http://community:3004',
      logger: silentLogger,
    })

    const result = await adapter.listOwnPosts('token-de-ana')

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://community:3004/api/me/posts',
      expect.objectContaining({ headers: { authorization: 'Bearer token-de-ana' } }),
    )
    expect(result).toEqual({
      available: true,
      posts: [
        {
          id: 'post-1',
          threadId: 'thread-1',
          content: 'Hola',
          createdAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    })
  })

  it('no disponible cuando el servicio responde con un error', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(503, {}))
    const adapter = new HttpCommunityReportAdapter({
      baseUrl: 'http://community:3004',
      logger: silentLogger,
    })

    expect(await adapter.listOwnPosts('token')).toEqual({ available: false, posts: [] })
  })

  it('no disponible cuando la red falla, sin lanzar', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('timeout'))
    const adapter = new HttpCommunityReportAdapter({
      baseUrl: 'http://community:3004',
      logger: silentLogger,
    })

    await expect(adapter.listOwnPosts('token')).resolves.toEqual({ available: false, posts: [] })
  })
})

describe('HttpCommerceReportAdapter (HU-45.3)', () => {
  it('sin baseUrl configurada, la seccion es no disponible sin llamar a fetch', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch')
    const adapter = new HttpCommerceReportAdapter({ baseUrl: null, logger: silentLogger })

    expect(await adapter.listOwnOrders('token')).toEqual({ available: false, orders: [] })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('recupera el historial de pedidos propio reenviando el testimonio del titular', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        jsonResponse(200, [
          { id: 'ord-1', status: 'CONFIRMED', currency: 'COP', total: 30000, itemCount: 5 },
        ]),
      )
    const adapter = new HttpCommerceReportAdapter({
      baseUrl: 'http://commerce:3005',
      logger: silentLogger,
    })

    const result = await adapter.listOwnOrders('token-de-ana')

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://commerce:3005/api/orders',
      expect.objectContaining({ headers: { authorization: 'Bearer token-de-ana' } }),
    )
    expect(result).toEqual({
      available: true,
      orders: [{ id: 'ord-1', status: 'CONFIRMED', currency: 'COP', total: 30000, itemCount: 5 }],
    })
  })

  it('no disponible cuando el servicio responde con un error', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(500, {}))
    const adapter = new HttpCommerceReportAdapter({
      baseUrl: 'http://commerce:3005',
      logger: silentLogger,
    })

    expect(await adapter.listOwnOrders('token')).toEqual({ available: false, orders: [] })
  })

  it('no disponible cuando la red falla, sin lanzar', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
    const adapter = new HttpCommerceReportAdapter({
      baseUrl: 'http://commerce:3005',
      logger: silentLogger,
    })

    await expect(adapter.listOwnOrders('token')).resolves.toEqual({ available: false, orders: [] })
  })
})
