import { HttpPlayerStatisticsReportAdapter } from '../../src/adapters/outbound/reporting/HttpPlayerStatisticsReportAdapter'
import { createLogger } from '../../src/infrastructure/observability/logger'
import {
  heroSelectionFixture,
  preparedStatisticsFixture,
} from '../support/player-statistics-fixture'

const logs: string[] = []
const logger = createLogger({
  level: 'warn',
  service: 'test',
  version: '0',
  sink: (line) => {
    logs.push(line)
  },
})
const adapter = (baseUrl: string | null = 'http://inventory:3002') =>
  new HttpPlayerStatisticsReportAdapter({ baseUrl, logger })
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

afterEach(() => {
  jest.restoreAllMocks()
  logs.length = 0
})

describe('Statistics desde la selección propia de Player-Inventory', () => {
  it('proyecta el contrato real sin mutarlo y hace un único GET sin selector, con el mismo Bearer', async () => {
    const body = heroSelectionFixture()
    const before = structuredClone(body)
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(response(body))
    expect(await adapter().getOwnPreparedHeroStatistics('token-de-ana')).toEqual({
      available: true,
      statistics: preparedStatisticsFixture(),
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://inventory:3002/api/inventories/me/heroes/selection',
      {
        method: 'GET',
        redirect: 'error',
        headers: { authorization: 'Bearer token-de-ana' },
        signal: expect.any(AbortSignal),
      },
    )
    expect(body).toEqual(before)
  })

  it('404 confirma ausencia de configuración preparada, no indisponibilidad técnica', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(response({ message: 'Sin selección' }, 404))
    expect(await adapter().getOwnPreparedHeroStatistics('token')).toEqual({
      available: true,
      statistics: null,
    })
  })

  it('sin URL no hace llamadas ni inventa estadísticas vacías', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch')
    expect(await adapter(null).getOwnPreparedHeroStatistics('token')).toEqual({
      available: false,
      statistics: null,
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it.each([401, 403, 429, 500, 503])('HTTP %s degrada solamente Statistics', async (status) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(response({}, status))
    expect(await adapter().getOwnPreparedHeroStatistics('token')).toEqual({
      available: false,
      statistics: null,
    })
  })

  it.each([
    null,
    {},
    { configuration: null },
    { ...heroSelectionFixture(), readiness: { ready: 'yes' } },
    {
      ...heroSelectionFixture(),
      configuration: { ...heroSelectionFixture().configuration, hero: { name: 3 } },
    },
    {
      ...heroSelectionFixture(),
      configuration: { ...heroSelectionFixture().configuration, baseStats: { power: 1 } },
    },
    {
      ...heroSelectionFixture(),
      configuration: {
        ...heroSelectionFixture().configuration,
        effectiveStats: { ...heroSelectionFixture().configuration.effectiveStats, attack: '15' },
      },
    },
    {
      ...heroSelectionFixture(),
      configuration: {
        ...heroSelectionFixture().configuration,
        deltas: [{ statistic: 'POWER', delta: '4' }],
      },
    },
    {
      ...heroSelectionFixture(),
      configuration: {
        ...heroSelectionFixture().configuration,
        baseStats: {
          ...heroSelectionFixture().configuration.baseStats,
          damage: { mode: 'DICE', count: 2 },
        },
      },
    },
    {
      ...heroSelectionFixture(),
      configuration: {
        ...heroSelectionFixture().configuration,
        baseStats: {
          ...heroSelectionFixture().configuration.baseStats,
          healing: { mode: 'UNKNOWN' },
        },
      },
    },
  ])('rechaza un payload malformado sin presentar ceros ni datos parciales (%#)', async (body) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(response(body))
    expect(await adapter().getOwnPreparedHeroStatistics('token')).toEqual({
      available: false,
      statistics: null,
    })
  })

  it('conserva null, magnitudes porcentuales y deltas vacíos', async () => {
    const body = heroSelectionFixture()
    const stats = {
      power: 0,
      health: 0,
      defense: 0,
      attack: null,
      damage: null,
      healing: { mode: 'PERCENTAGE', basisPoints: 1250 },
    }
    jest.spyOn(global, 'fetch').mockResolvedValue(
      response({
        ...body,
        configuration: {
          ...body.configuration,
          baseStats: stats,
          effectiveStats: stats,
          deltas: [],
        },
        readiness: { ready: false, blockers: [] },
      }),
    )
    expect(await adapter().getOwnPreparedHeroStatistics('token')).toEqual({
      available: true,
      statistics: {
        hero: { name: 'Guerrera de Ana', reference: 'guerrera' },
        baseStats: stats,
        effectiveStats: stats,
        deltas: [],
        ready: false,
      },
    })
  })

  it('JSON inválido y errores de red no exponen token ni datos del error en logs', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('invalid-json'))
      .mockRejectedValueOnce(new Error('token-secreto correo@privado.test'))
    expect(await adapter().getOwnPreparedHeroStatistics('token-secreto')).toEqual({
      available: false,
      statistics: null,
    })
    expect(await adapter().getOwnPreparedHeroStatistics('token-secreto')).toEqual({
      available: false,
      statistics: null,
    })
    expect(logs.join('')).not.toMatch(/token-secreto|correo@privado/u)
  })

  it('aborta la petición mediante el timeout de 5000 ms y devuelve indisponibilidad', async () => {
    const controller = new AbortController()
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    jest.spyOn(global, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              reject(new DOMException('Timeout', 'TimeoutError'))
            },
            { once: true },
          )
        }),
    )
    const result = adapter().getOwnPreparedHeroStatistics('token')
    controller.abort()
    expect(await result).toEqual({ available: false, statistics: null })
    expect(timeoutSpy).toHaveBeenCalledWith(5000)
  })
})
