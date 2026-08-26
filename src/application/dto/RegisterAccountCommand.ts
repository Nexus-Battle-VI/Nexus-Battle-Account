export interface RegisterAccountCommand {
  readonly email: string
  readonly displayName: string

  /**
   * Sujeto ya existente en el proveedor de identidad.
   *
   * Se informa cuando quien registra llega con un testimonio verificado: en ese
   * caso el sujeto YA existe y crearlo de nuevo produciria dos identidades para
   * la misma persona. Cuando no se informa, el caso de uso lo da de alta.
   */
  readonly subject?: string
}
