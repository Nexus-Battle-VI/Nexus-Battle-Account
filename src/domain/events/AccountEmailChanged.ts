import type { DomainEvent } from './DomainEvent'

export interface AccountEmailChanged extends DomainEvent {
  readonly name: 'account.email-changed'
  readonly previousEmail: string
  readonly newEmail: string
}

export const accountEmailChanged = (params: {
  aggregateId: string
  previousEmail: string
  newEmail: string
  occurredAt: Date
}): AccountEmailChanged => ({
  name: 'account.email-changed',
  aggregateId: params.aggregateId,
  previousEmail: params.previousEmail,
  newEmail: params.newEmail,
  occurredAt: params.occurredAt,
})
