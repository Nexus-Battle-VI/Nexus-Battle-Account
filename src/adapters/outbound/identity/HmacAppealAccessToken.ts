import { createHmac, timingSafeEqual } from 'node:crypto'

import type {
  AppealAccessTokenPayload,
  AppealAccessTokenPort,
} from '../../../application/ports/AppealAccessTokenPort'
import type { ClockPort } from '../../../application/ports/ClockPort'

interface SignedClaims extends AppealAccessTokenPayload {
  readonly exp: number
}

/**
 * Adaptador real de `AppealAccessTokenPort`: HMAC-SHA256 sobre un payload
 * propio, en el mismo espiritu que `internal-signature.ts` (firma con un
 * secreto que solo este servicio conoce), pero para un titular autenticado en
 * vez de para otro servicio.
 */
export class HmacAppealAccessToken implements AppealAccessTokenPort {
  constructor(
    private readonly secret: string,
    private readonly clock: ClockPort,
  ) {}

  issue(payload: AppealAccessTokenPayload, expiresInSeconds: number): string {
    const claims: SignedClaims = {
      ...payload,
      exp: Math.floor(this.clock.now().getTime() / 1000) + expiresInSeconds,
    }

    const body = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')
    const signature = this.sign(body)

    return `${body}.${signature}`
  }

  verify(token: string): AppealAccessTokenPayload | null {
    const parts = token.split('.')

    if (parts.length !== 2) {
      return null
    }

    const [body, signature] = parts

    if (body === undefined || signature === undefined || body.length === 0) {
      return null
    }

    const expected = this.sign(body)

    if (!HmacAppealAccessToken.signatureMatches(expected, signature)) {
      return null
    }

    let claims: SignedClaims

    try {
      claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SignedClaims
    } catch {
      return null
    }

    if (
      typeof claims.accountId !== 'string' ||
      typeof claims.subject !== 'string' ||
      typeof claims.exp !== 'number'
    ) {
      return null
    }

    const now = Math.floor(this.clock.now().getTime() / 1000)

    if (claims.exp <= now) {
      return null
    }

    return { accountId: claims.accountId, subject: claims.subject }
  }

  private sign(body: string): string {
    return createHmac('sha256', this.secret).update(body, 'utf8').digest('hex')
  }

  private static signatureMatches(expected: string, received: string): boolean {
    const a = Buffer.from(expected, 'utf8')
    const b = Buffer.from(received, 'utf8')

    return a.length === b.length && timingSafeEqual(a, b)
  }
}
