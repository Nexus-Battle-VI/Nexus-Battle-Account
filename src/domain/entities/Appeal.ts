import { DomainError } from '../errors/DomainError'
import { addBusinessDays } from '../policies/BusinessDaysPolicy'
import { AppealStatus } from './AppealStatus'
import type { AppealDecision as AppealDecisionValue } from './AppealDecision'

const DECISION_WINDOW_BUSINESS_DAYS = 15

export interface AppealSnapshot {
  readonly id: string
  readonly sanctionId: string
  readonly accountId: string
  readonly statement: string
  readonly submittedAt: Date
  readonly decisionDueAt: Date
  readonly status: AppealStatus
  readonly decision: AppealDecisionValue | null
  readonly resolutionNotes: string | null
  readonly resolvedByAccountId: string | null
  readonly resolvedAt: Date | null
}

/**
 * Apelacion de una sancion (HU-42, §7.3.2 "Proceso de apelacion"): ticket
 * persistido, revisado por un panel y resuelto con una decision final.
 *
 * Una sola apelacion por sancion -`SubmitAppeal` lo exige antes de crear esta
 * instancia-, por eso esta clase no necesita conocer si hay otra previa.
 */
export class Appeal {
  private status: AppealStatus
  private decision: AppealDecisionValue | null
  private resolutionNotes: string | null
  private resolvedByAccountId: string | null
  private resolvedAt: Date | null

  private constructor(
    readonly id: string,
    readonly sanctionId: string,
    readonly accountId: string,
    readonly statement: string,
    readonly submittedAt: Date,
    readonly decisionDueAt: Date,
    params: {
      status: AppealStatus
      decision: AppealDecisionValue | null
      resolutionNotes: string | null
      resolvedByAccountId: string | null
      resolvedAt: Date | null
    },
  ) {
    this.status = params.status
    this.decision = params.decision
    this.resolutionNotes = params.resolutionNotes
    this.resolvedByAccountId = params.resolvedByAccountId
    this.resolvedAt = params.resolvedAt
  }

  static submit(params: {
    id: string
    sanctionId: string
    accountId: string
    statement: string
    submittedAt: Date
  }): Appeal {
    if (params.id.trim().length === 0) {
      throw new DomainError('La apelacion debe tener un identificador.')
    }

    if (params.sanctionId.trim().length === 0) {
      throw new DomainError('La apelacion debe identificar la sancion apelada.')
    }

    if (params.accountId.trim().length === 0) {
      throw new DomainError('La apelacion debe identificar a la cuenta que apela.')
    }

    if (params.statement.trim().length === 0) {
      throw new DomainError('La apelacion debe incluir una justificacion.')
    }

    return new Appeal(
      params.id,
      params.sanctionId,
      params.accountId,
      params.statement.trim(),
      params.submittedAt,
      addBusinessDays(params.submittedAt, DECISION_WINDOW_BUSINESS_DAYS),
      {
        status: AppealStatus.Submitted,
        decision: null,
        resolutionNotes: null,
        resolvedByAccountId: null,
        resolvedAt: null,
      },
    )
  }

  static restore(snapshot: AppealSnapshot): Appeal {
    return new Appeal(
      snapshot.id,
      snapshot.sanctionId,
      snapshot.accountId,
      snapshot.statement,
      snapshot.submittedAt,
      snapshot.decisionDueAt,
      {
        status: snapshot.status,
        decision: snapshot.decision,
        resolutionNotes: snapshot.resolutionNotes,
        resolvedByAccountId: snapshot.resolvedByAccountId,
        resolvedAt: snapshot.resolvedAt,
      },
    )
  }

  get currentStatus(): AppealStatus {
    return this.status
  }

  get currentDecision(): AppealDecisionValue | null {
    return this.decision
  }

  get isResolved(): boolean {
    return this.status === AppealStatus.Resolved
  }

  isOverdue(at: Date): boolean {
    return !this.isResolved && at.getTime() > this.decisionDueAt.getTime()
  }

  resolve(params: {
    decision: AppealDecisionValue
    notes: string
    resolvedByAccountId: string
    resolvedAt: Date
  }): void {
    if (this.isResolved) {
      throw new DomainError(`La apelacion ${this.id} ya fue resuelta.`)
    }

    if (params.notes.trim().length === 0) {
      throw new DomainError('La resolucion de una apelacion debe incluir una justificacion.')
    }

    this.status = AppealStatus.Resolved
    this.decision = params.decision
    this.resolutionNotes = params.notes.trim()
    this.resolvedByAccountId = params.resolvedByAccountId
    this.resolvedAt = params.resolvedAt
  }

  toSnapshot(): AppealSnapshot {
    return {
      id: this.id,
      sanctionId: this.sanctionId,
      accountId: this.accountId,
      statement: this.statement,
      submittedAt: this.submittedAt,
      decisionDueAt: this.decisionDueAt,
      status: this.status,
      decision: this.decision,
      resolutionNotes: this.resolutionNotes,
      resolvedByAccountId: this.resolvedByAccountId,
      resolvedAt: this.resolvedAt,
    }
  }
}
