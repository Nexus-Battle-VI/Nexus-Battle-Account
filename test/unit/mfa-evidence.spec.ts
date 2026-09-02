import { MfaEvidence } from '../../src/domain/entities/MfaEvidence'
import { SecondFactorMethod } from '../../src/domain/entities/SecondFactorMethod'

describe('MfaEvidence', () => {
  const VERIFIED_AT = new Date('2026-09-02T05:00:00.000Z')
  const EXPIRES_AT = new Date('2026-09-02T05:15:00.000Z')

  const createEvidence = (): MfaEvidence =>
    MfaEvidence.create({
      subject: 'admin-subject',
      jti: 'access-token-jti',
      method: SecondFactorMethod.AuthenticatorApp,
      verifiedAt: VERIFIED_AT,
      expiresAt: EXPIRES_AT,
    })

  it('conserva el metodo que origino la evidencia', () => {
    expect(createEvidence().toSnapshot()).toEqual({
      subject: 'admin-subject',
      jti: 'access-token-jti',
      method: SecondFactorMethod.AuthenticatorApp,
      verifiedAt: VERIFIED_AT,
      expiresAt: EXPIRES_AT,
    })
  })

  it('vence en el instante exacto de expiracion', () => {
    const evidence = createEvidence()

    expect(evidence.isValidAt(new Date('2026-09-02T05:14:59.999Z'))).toBe(true)
    expect(evidence.isValidAt(EXPIRES_AT)).toBe(false)
  })

  it('rechaza un metodo fuera del vocabulario cerrado', () => {
    expect(() =>
      MfaEvidence.create({
        subject: 'admin-subject',
        jti: 'access-token-jti',
        method: 'PUSH_NOTIFICATION' as never,
        verifiedAt: VERIFIED_AT,
        expiresAt: EXPIRES_AT,
      }),
    ).toThrow('metodo reconocido')
  })
})
