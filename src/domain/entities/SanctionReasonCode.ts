/**
 * HU-42 (RF-42, PDF "Proyecto Integrador II" v1.26.10 §7.3.2 "Causales de
 * sanción"): catálogo oficial de 8 causales, documentado tal cual aparece en
 * el documento. `Other` y `AuctionTermsViolation` son anteriores a HU-42
 * (HU-90, CA-05) y se conservan por compatibilidad histórica: hay sanciones ya
 * persistidas con esos códigos y consumidores (Auction) que los esperan.
 */
export const SanctionReasonCode = {
  Other: 'OTHER',
  AuctionTermsViolation: 'AUCTION_TERMS_VIOLATION',
  OffensiveLanguage: 'OFFENSIVE_LANGUAGE',
  Harassment: 'HARASSMENT',
  FraudOrManipulation: 'FRAUD_OR_MANIPULATION',
  UnauthorizedSoftwareOrCheating: 'UNAUTHORIZED_SOFTWARE_OR_CHEATING',
  IdentityImpersonation: 'IDENTITY_IMPERSONATION',
  PrivacyPolicyViolation: 'PRIVACY_POLICY_VIOLATION',
  TermsOfServiceViolation: 'TERMS_OF_SERVICE_VIOLATION',
  LegalRelationshipTermination: 'LEGAL_RELATIONSHIP_TERMINATION',
} as const

export type SanctionReasonCode = (typeof SanctionReasonCode)[keyof typeof SanctionReasonCode]

export const ALL_SANCTION_REASON_CODES: readonly SanctionReasonCode[] = [
  SanctionReasonCode.Other,
  SanctionReasonCode.AuctionTermsViolation,
  SanctionReasonCode.OffensiveLanguage,
  SanctionReasonCode.Harassment,
  SanctionReasonCode.FraudOrManipulation,
  SanctionReasonCode.UnauthorizedSoftwareOrCheating,
  SanctionReasonCode.IdentityImpersonation,
  SanctionReasonCode.PrivacyPolicyViolation,
  SanctionReasonCode.TermsOfServiceViolation,
  SanctionReasonCode.LegalRelationshipTermination,
]

export const isSanctionReasonCode = (value: string): value is SanctionReasonCode =>
  (ALL_SANCTION_REASON_CODES as readonly string[]).includes(value)
