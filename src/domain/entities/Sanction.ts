import { DomainError } from '../errors/DomainError'
import type { SanctionType } from './SanctionType'

export interface SanctionSnapshot {
  readonly id: string
  readonly targetAccountId: string
  readonly actorAccountId: string
  readonly type: SanctionType
  readonly reason: string
  readonly createdAt: Date
}

export class Sanction {
  private constructor(
    readonly id: string,
    readonly targetAccountId: string,
    readonly actorAccountId: string,
    readonly type: SanctionType,
    readonly reason: string,
    readonly createdAt: Date,
  ) {}

  static create(params: {
    id: string
    targetAccountId: string
    actorAccountId: string
    type: SanctionType
    reason: string
    createdAt: Date
  }): Sanction {
    if (params.id.trim().length === 0) {
      throw new DomainError('La sancion debe tener un identificador.')
    }

    if (params.targetAccountId.trim().length === 0) {
      throw new DomainError('La sancion debe identificar al usuario sancionado.')
    }

    if (params.actorAccountId.trim().length === 0) {
      throw new DomainError('La sancion debe identificar al actor responsable.')
    }

    if (params.reason.trim().length === 0) {
      throw new DomainError('La sancion debe incluir una causal.')
    }

    return new Sanction(
      params.id,
      params.targetAccountId,
      params.actorAccountId,
      params.type,
      params.reason.trim(),
      params.createdAt,
    )
  }

  static restore(snapshot: SanctionSnapshot): Sanction {
    return new Sanction(
      snapshot.id,
      snapshot.targetAccountId,
      snapshot.actorAccountId,
      snapshot.type,
      snapshot.reason,
      snapshot.createdAt,
    )
  }

  toSnapshot(): SanctionSnapshot {
    return {
      id: this.id,
      targetAccountId: this.targetAccountId,
      actorAccountId: this.actorAccountId,
      type: this.type,
      reason: this.reason,
      createdAt: this.createdAt,
    }
  }
}