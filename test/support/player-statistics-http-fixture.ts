import { createServer } from 'node:http'
import { heroSelectionFixture } from './player-statistics-fixture'

/** Frontera HTTP reproducible del contrato auditado; no sustituye una prueba del despliegue remoto. */
export class PlayerStatisticsHttpFixture {
  status = 200
  body: unknown = heroSelectionFixture()
  lastAccessToken: string | null = null
  readonly requests: { method: string | undefined; url: string | undefined }[] = []
  private readonly server = createServer((request, response) => {
    this.requests.push({ method: request.method, url: request.url })
    this.lastAccessToken = request.headers.authorization?.replace(/^Bearer /u, '') ?? null
    if (request.method !== 'GET' || request.url !== '/api/inventories/me/heroes/selection') {
      response.writeHead(400).end()
      return
    }
    if (!['token-jugador', 'token-jugador-b'].includes(this.lastAccessToken ?? '')) {
      response.writeHead(401).end()
      return
    }
    const body =
      this.lastAccessToken === 'token-jugador-b'
        ? heroSelectionFixture('Maga de Beatriz', 37)
        : this.body
    response.writeHead(this.status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(body))
  })

  async start(): Promise<string> {
    await new Promise<void>((resolve) => {
      this.server.listen(0, '127.0.0.1', resolve)
    })
    const address = this.server.address()
    if (address === null || typeof address === 'string')
      throw new Error('Sin puerto HTTP de prueba')
    return `http://127.0.0.1:${String(address.port)}`
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }
}
