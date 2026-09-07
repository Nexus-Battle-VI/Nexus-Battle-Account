export const SanctionType = {
  Warning: 'WARNING',
  TemporarySuspension: 'TEMPORARY_SUSPENSION',
  PermanentBan: 'PERMANENT_BAN',
} as const

export type SanctionType =
  (typeof SanctionType)[keyof typeof SanctionType]

export const ALL_SANCTION_TYPES: readonly SanctionType[] = [
  SanctionType.Warning,
  SanctionType.TemporarySuspension,
  SanctionType.PermanentBan,
]

export const isSanctionType = (
  value: string,
): value is SanctionType =>
  (ALL_SANCTION_TYPES as readonly string[]).includes(value)