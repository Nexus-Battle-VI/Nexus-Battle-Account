import { Sanction } from '../../src/domain/entities/Sanction'
import {
  ALL_SANCTION_REASON_CODES,
  SanctionReasonCode,
  isSanctionReasonCode,
} from '../../src/domain/entities/SanctionReasonCode'
import { SanctionType } from '../../src/domain/entities/SanctionType'
import { DomainError } from '../../src/domain/errors/DomainError'

const CREATED_AT = new Date('2026-10-03T12:00:00.000Z')

const warning = (reasonCode: SanctionReasonCode, reason = 'Aviso al vendedor.') =>
  Sanction.create({
    id: 'sancion-1',
    targetAccountId: 'vendedor-1',
    actorAccountId: 'moderador-1',
    type: SanctionType.Warning,
    reason,
    reasonCode,
    createdAt: CREATED_AT,
  })

describe('SanctionReasonCode (HU-90, CA-05)', () => {
  it('expone exactamente OTHER y AUCTION_TERMS_VIOLATION', () => {
    expect(ALL_SANCTION_REASON_CODES).toEqual(['OTHER', 'AUCTION_TERMS_VIOLATION'])
  })

  it('acepta solo códigos conocidos', () => {
    expect(isSanctionReasonCode('OTHER')).toBe(true)
    expect(isSanctionReasonCode('AUCTION_TERMS_VIOLATION')).toBe(true)
    expect(isSanctionReasonCode('auction_terms_violation')).toBe(false)
    expect(isSanctionReasonCode('CODIGO_INVENTADO')).toBe(false)
    expect(isSanctionReasonCode('')).toBe(false)
  })

  it('crea una sanción con OTHER', () => {
    expect(warning(SanctionReasonCode.Other).toSnapshot().reasonCode).toBe('OTHER')
  })

  it('crea una sanción con AUCTION_TERMS_VIOLATION', () => {
    expect(warning(SanctionReasonCode.AuctionTermsViolation).toSnapshot().reasonCode).toBe(
      'AUCTION_TERMS_VIOLATION',
    )
  })

  it('rechaza un código desconocido', () => {
    expect(() => warning('CODIGO_INVENTADO' as SanctionReasonCode)).toThrow(DomainError)
  })

  it('exige un código de motivo: rechaza una sanción sin reasonCode', () => {
    expect(() => warning(undefined as unknown as SanctionReasonCode)).toThrow(DomainError)
  })

  it('sigue exigiendo el motivo humano aunque el código sea válido', () => {
    expect(() => warning(SanctionReasonCode.AuctionTermsViolation, '   ')).toThrow(DomainError)
  })

  it('restore conserva el código y el motivo humano', () => {
    const restored = Sanction.restore({
      id: 'sancion-2',
      targetAccountId: 'vendedor-1',
      actorAccountId: 'moderador-1',
      type: SanctionType.TemporarySuspension,
      reason: 'Infraccion persistida.',
      reasonCode: SanctionReasonCode.AuctionTermsViolation,
      createdAt: CREATED_AT,
      expiresAt: new Date('2026-10-04T12:00:00.000Z'),
    })

    expect(restored.toSnapshot()).toMatchObject({
      reason: 'Infraccion persistida.',
      reasonCode: SanctionReasonCode.AuctionTermsViolation,
    })
  })
})
