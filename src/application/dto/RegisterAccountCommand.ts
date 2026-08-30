export interface RegisterSecurityAnswer {
  readonly questionId: string
  readonly answer: string
}

export interface RegisterAvatarUpload {
  readonly mimeType: string
  readonly originalName: string
  readonly sizeBytes: number
  readonly bytes: Buffer
}

export interface RegisterAccountCommand {
  readonly email: string
  /**
   * Se transporta a Cognito por `signUp` y NO se persiste (ADR-004, decision 2).
   * La politica la aplica el proveedor.
   */
  readonly password: string
  /** Apodo de HU-01. Se valida como `DisplayName`. */
  readonly displayName: string
  readonly firstNames: string
  readonly lastNames: string
  readonly termsAccepted: boolean
  readonly securityAnswers: readonly RegisterSecurityAnswer[]
  readonly avatar?: RegisterAvatarUpload
}
