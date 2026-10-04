export const SanctionReasonCode = {
  Other: 'OTHER',
  AuctionTermsViolation: 'AUCTION_TERMS_VIOLATION',
} as const

export type SanctionReasonCode = (typeof SanctionReasonCode)[keyof typeof SanctionReasonCode]

export const ALL_SANCTION_REASON_CODES: readonly SanctionReasonCode[] = [
  SanctionReasonCode.Other,
  SanctionReasonCode.AuctionTermsViolation,
]

export const isSanctionReasonCode = (value: string): value is SanctionReasonCode =>
  (ALL_SANCTION_REASON_CODES as readonly string[]).includes(value)
