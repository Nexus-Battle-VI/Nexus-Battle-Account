import { DomainError } from '../errors/DomainError'
import {
  SanctionType,
  type SanctionType as SanctionTypeValue,
} from './SanctionType'

const APPEAL_WINDOW_DAYS = 30
const APPEAL_WINDOW_MS =
  APPEAL_WINDOW_DAYS * 24 * 60 * 60 * 1000

export interface SanctionSnapshot {
  readonly id: string
  readonly targetAccountId: string
  readonly actorAccountId: string
  readonly type: SanctionTypeValue
  readonly reason: string
  readonly createdAt: Date
  readonly expiresAt: Date | null
  readonly appealDeadline: Date
}

export type PersistedSanctionSnapshot = Omit<
  SanctionSnapshot,
  'appealDeadline'
>

export class Sanction {
  private constructor(
    readonly id: string,
    readonly targetAccountId: string,
    readonly actorAccountId: string,
    readonly type: SanctionTypeValue,
    readonly reason: string,
    readonly createdAt: Date,
    readonly expiresAt: Date | null,
  ) {}

  static create(params: {
    id: string
    targetAccountId: string
    actorAccountId: string
    type: SanctionTypeValue
    reason: string
    createdAt: Date
    expiresAt?: Date | null
  }): Sanction {
    if (params.id.trim().length === 0) {
      throw new DomainError(
        'La sancion debe tener un identificador.',
      )
    }

    if (params.targetAccountId.trim().length === 0) {
      throw new DomainError(
        'La sancion debe identificar al usuario sancionado.',
      )
    }

    if (params.actorAccountId.trim().length === 0) {
      throw new DomainError(
        'La sancion debe identificar al actor responsable.',
      )
    }

    if (params.reason.trim().length === 0) {
      throw new DomainError(
        'La sancion debe incluir una causal.',
      )
    }

    const expiresAt = params.expiresAt ?? null

    if (
      params.type === SanctionType.TemporarySuspension
    ) {
      if (expiresAt === null) {
        throw new DomainError(
          'Una suspension temporal debe indicar su fecha de finalizacion.',
        )
      }

      if (
        expiresAt.getTime() <=
        params.createdAt.getTime()
      ) {
        throw new DomainError(
          'La fecha de finalizacion de la suspension debe ser posterior a su inicio.',
        )
      }
    }

    if (
      params.type !==
        SanctionType.TemporarySuspension &&
      expiresAt !== null
    ) {
      throw new DomainError(
        'Solo una suspension temporal puede tener fecha de finalizacion.',
      )
    }

    return new Sanction(
      params.id,
      params.targetAccountId,
      params.actorAccountId,
      params.type,
      params.reason.trim(),
      params.createdAt,
      expiresAt,
    )
  }

  static restore(
    snapshot: PersistedSanctionSnapshot,
  ): Sanction {
    return new Sanction(
      snapshot.id,
      snapshot.targetAccountId,
      snapshot.actorAccountId,
      snapshot.type,
      snapshot.reason,
      snapshot.createdAt,
      snapshot.expiresAt,
    )
  }

  get isTemporary(): boolean {
    return (
      this.type ===
      SanctionType.TemporarySuspension
    )
  }

  get appealDeadline(): Date {
    return new Date(
      this.createdAt.getTime() + APPEAL_WINDOW_MS,
    )
  }

  canAppeal(at: Date): boolean {
    const timestamp = at.getTime()

    return (
      timestamp >= this.createdAt.getTime() &&
      timestamp <= this.appealDeadline.getTime()
    )
  }

  isExpired(at: Date): boolean {
    if (this.expiresAt === null) {
      return false
    }

    return (
      this.expiresAt.getTime() <= at.getTime()
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
      expiresAt: this.expiresAt,
      appealDeadline: this.appealDeadline,
    }
  }
}