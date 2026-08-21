import type { DomainEvent } from './DomainEvent'

export interface AccountVerified extends DomainEvent {
  readonly name: 'account.verified'
  readonly email: string
}

export const accountVerified = (params: {
  aggregateId: string
  email: string
  occurredAt: Date
}): AccountVerified => ({
  name: 'account.verified',
  aggregateId: params.aggregateId,
  email: params.email,
  occurredAt: params.occurredAt,
})
