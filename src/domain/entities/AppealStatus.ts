export const AppealStatus = {
  Submitted: 'SUBMITTED',
  Resolved: 'RESOLVED',
} as const

export type AppealStatus = (typeof AppealStatus)[keyof typeof AppealStatus]
