import { ConfiguredPrivacyPolicyVersion } from '../../src/adapters/outbound/policy/ConfiguredPrivacyPolicyVersion'

describe('ConfiguredPrivacyPolicyVersion', () => {
  it('reconoce como aplicable solo la version configurada', () => {
    const policy = new ConfiguredPrivacyPolicyVersion('v0.3')

    expect(policy.isApplicable('v0.3')).toBe(true)
    expect(policy.isApplicable('v0.4')).toBe(false)
    expect(policy.isApplicable('')).toBe(false)
  })

  it('sin version configurada, ninguna version es aplicable', () => {
    // Es el valor por defecto en produccion mientras la Politica siga sin
    // aprobacion formal (EN-011, CA-02): que exista privacy-policy-v0.3.md en
    // Infrastructure no debe activar nada aqui por si solo.
    const policy = new ConfiguredPrivacyPolicyVersion(null)

    expect(policy.isApplicable('v0.3')).toBe(false)
    expect(policy.isApplicable('')).toBe(false)
  })
})
