import type { DomainEvent } from './DomainEvent'

export interface AccountRegistered extends DomainEvent {
  readonly name: 'account.registered'
  readonly email: string
  readonly displayName: string
}

export const accountRegistered = (params: {
  aggregateId: string
  email: string
  displayName: string
  occurredAt: Date
}): AccountRegistered => ({
  name: 'account.registered',
  aggregateId: params.aggregateId,
  email: params.email,
  displayName: params.displayName,
  occurredAt: params.occurredAt,
})
