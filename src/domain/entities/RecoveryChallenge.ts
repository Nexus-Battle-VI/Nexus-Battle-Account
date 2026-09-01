export const RecoveryStage = {
  Identified: 'IDENTIFIED',
  QuestionsVerified: 'QUESTIONS_VERIFIED',
  CodeVerified: 'CODE_VERIFIED',
  Completed: 'COMPLETED',
} as const

export type RecoveryStage = (typeof RecoveryStage)[keyof typeof RecoveryStage]

export interface RecoveryChallengeSnapshot {
  readonly token: string
  readonly email: string
  readonly accountId: string | null
  readonly stage: RecoveryStage
  readonly codeHash: string | null
  readonly createdAt: string
}

/**
 * Proceso temporal de recuperacion de contrasena (HU-04).
 *
 * No es el agregado Account: solo recuerda que etapa se alcanzo y, si hay
 * codigo, su resumen. El codigo en claro nunca vive aqui.
 */
export class RecoveryChallenge {
  readonly token: string
  readonly email: string
  readonly accountId: string | null
  private stage: RecoveryStage
  private codeHash: string | null
  readonly createdAt: Date

  private constructor(snapshot: RecoveryChallengeSnapshot) {
    this.token = snapshot.token
    this.email = snapshot.email
    this.accountId = snapshot.accountId
    this.stage = snapshot.stage
    this.codeHash = snapshot.codeHash
    this.createdAt = new Date(snapshot.createdAt)
  }

  static start(input: {
    token: string
    email: string
    accountId: string | null
    occurredAt: Date
  }): RecoveryChallenge {
    return new RecoveryChallenge({
      token: input.token,
      email: input.email,
      accountId: input.accountId,
      stage: RecoveryStage.Identified,
      codeHash: null,
      createdAt: input.occurredAt.toISOString(),
    })
  }

  static restore(snapshot: RecoveryChallengeSnapshot): RecoveryChallenge {
    return new RecoveryChallenge(snapshot)
  }

  get currentStage(): RecoveryStage {
    return this.stage
  }

  get currentCodeHash(): string | null {
    return this.codeHash
  }

  get isBoundToAccount(): boolean {
    return this.accountId !== null
  }

  markQuestionsVerified(codeHash: string): void {
    if (this.stage !== RecoveryStage.Identified) {
      throw new Error('El desafio no admite validar preguntas en esta etapa.')
    }

    this.stage = RecoveryStage.QuestionsVerified
    this.codeHash = codeHash
  }

  markCodeVerified(): void {
    if (this.stage !== RecoveryStage.QuestionsVerified) {
      throw new Error('El desafio no admite validar el codigo en esta etapa.')
    }

    this.stage = RecoveryStage.CodeVerified
    this.codeHash = null
  }

  markCompleted(): void {
    if (this.stage !== RecoveryStage.CodeVerified) {
      throw new Error('El desafio no admite cambiar la contrasena en esta etapa.')
    }

    this.stage = RecoveryStage.Completed
  }

  toSnapshot(): RecoveryChallengeSnapshot {
    return {
      token: this.token,
      email: this.email,
      accountId: this.accountId,
      stage: this.stage,
      codeHash: this.codeHash,
      createdAt: this.createdAt.toISOString(),
    }
  }
}
