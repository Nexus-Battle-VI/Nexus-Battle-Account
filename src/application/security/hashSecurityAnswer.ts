import { createHash } from 'node:crypto'

import { DomainError } from '../../domain/errors/DomainError'

export const normalizeSecurityAnswer = (answer: string): string =>
  answer.trim().toLowerCase().replace(/\s+/gu, ' ')

/**
 * Resumen irreversible de una respuesta de seguridad.
 *
 * Nunca se persiste ni se registra el texto en claro.
 */
export const hashSecurityAnswer = (answer: string): string => {
  const normalized = normalizeSecurityAnswer(answer)

  if (normalized.length === 0) {
    throw new DomainError('Una respuesta de seguridad no puede estar vacia.')
  }

  return createHash('sha256').update(normalized, 'utf8').digest('hex')
}
