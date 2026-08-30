/**
 * Consulta el correo que el proveedor comprobo para un sujeto.
 *
 * El correo no forma parte del access token que autoriza las peticiones. Esta
 * capacidad es un puerto separado para que la aplicacion pueda pedir el dato
 * al proveedor sin importar su SDK ni confiar en el cuerpo HTTP.
 */
export interface VerifiedEmailDirectoryPort {
  findVerifiedEmail(subject: string): Promise<string | null>
}

/**
 * El proveedor no pudo confirmar cual correo verifico para el sujeto.
 *
 * No se confunde con `null`: `null` es una respuesta valida que significa que
 * no hay correo verificado; este error significa que no se pudo comprobar y el
 * registro debe fallar cerrado.
 */
export class VerifiedEmailDirectoryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VerifiedEmailDirectoryError'
  }
}

export const VERIFIED_EMAIL_DIRECTORY = Symbol('VerifiedEmailDirectoryPort')
