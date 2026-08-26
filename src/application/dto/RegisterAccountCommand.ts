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
  readonly password: string
  /** Apodo de HU-01. Se valida como `DisplayName`. */
  readonly displayName: string
  readonly firstNames: string
  readonly lastNames: string
  readonly termsAccepted: boolean
  readonly securityAnswers: readonly RegisterSecurityAnswer[]
  readonly avatar?: RegisterAvatarUpload

  /**
   * Sujeto ya existente en el proveedor de identidad.
   *
   * Se informa cuando quien registra llega con un testimonio verificado: en ese
   * caso el sujeto YA existe y crearlo de nuevo produciria dos identidades para
   * la misma persona. Cuando no se informa, el caso de uso lo da de alta.
   */
  readonly subject?: string
}
