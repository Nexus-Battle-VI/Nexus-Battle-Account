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

  /**
   * Correo que el PROVEEDOR declara verificado, tal y como llega en el
   * testimonio. No es el del formulario: el formulario lo escribe quien
   * registra, y eso no demuestra nada.
   *
   * Cuando coincide con el correo registrado, la cuenta nace ACTIVA. La
   * verificacion pendiente espera exactamente esa prueba -que alguien controla
   * ese buzon- y el proveedor ya la hizo. Repetirla seria pedir dos veces lo
   * mismo, y hasta ahora nadie resolvia la segunda: toda cuenta nacida del
   * flujo real se quedaba PENDING_VERIFICATION para siempre, sin poder usar el
   * inicio de sesion por credenciales.
   */
  readonly verifiedEmail?: string | null
}
