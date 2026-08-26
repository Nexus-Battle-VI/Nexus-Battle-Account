import type { INestApplication } from '@nestjs/common'
import request from 'supertest'

import { FOUR_ANSWERS, VALID_PASSWORD } from './account-factory'

export const registerAccountRequest = (
  app: INestApplication,
  fields: Record<string, string> = {},
  attachAvatar = true,
) => {
  const req = request(app.getHttpServer()).post('/api/accounts')

  const body = {
    firstNames: 'Ana',
    lastNames: 'Ramirez',
    email: 'jugador@nexus.test',
    password: VALID_PASSWORD,
    nickname: 'Ana Ramirez',
    termsAccepted: 'true',
    securityAnswers: JSON.stringify(FOUR_ANSWERS),
    ...fields,
  }

  for (const [key, value] of Object.entries(body)) {
    req.field(key, value)
  }

  if (attachAvatar) {
    req.attach('avatar', Buffer.from('png-bytes'), { filename: 'a.png', contentType: 'image/png' })
  }

  return req
}
