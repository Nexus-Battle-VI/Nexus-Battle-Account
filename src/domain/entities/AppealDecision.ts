export const AppealDecision = {
  Upheld: 'UPHELD',
  Overturned: 'OVERTURNED',
} as const

export type AppealDecision = (typeof AppealDecision)[keyof typeof AppealDecision]

export const ALL_APPEAL_DECISIONS: readonly AppealDecision[] = [
  AppealDecision.Upheld,
  AppealDecision.Overturned,
]

export const isAppealDecision = (value: string): value is AppealDecision =>
  (ALL_APPEAL_DECISIONS as readonly string[]).includes(value)
