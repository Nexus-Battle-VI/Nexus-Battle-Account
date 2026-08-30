import type { Role } from '../../domain/entities/Role'

/**
 * Puerto de verificacion del testimonio de identidad.
 *
 * El servicio no emite tokens ni custodia claves: solo comprueba que el
 * testimonio que acompana a la peticion lo firmo el proveedor de identidad y
 * que sigue siendo valido. Vease ADR-004.
 *
 * La verificacion es un puerto y no una llamada directa a una biblioteca para
 * que las pruebas puedan ejercitar la autorizacion sin depender de una red ni
 * de un proveedor real.
 */
export interface VerifiedIdentity {
  /** `sub` del proveedor. Es estable: un correo no lo es. */
  readonly subject: string

  /** Roles reconocidos. Los grupos desconocidos se descartan. */
  readonly roles: ReadonlySet<Role>
}

export interface TokenVerifierPort {
  verify(token: string): Promise<VerifiedIdentity>
}

/**
 * Fallo de verificacion. Deliberadamente sin detalle: el motivo exacto por el
 * que un token no es valido es informacion util para quien lo esta falsificando.
 */
export class TokenVerificationError extends Error {
  constructor(message = 'El testimonio de identidad no es valido.') {
    super(message)
    this.name = 'TokenVerificationError'
  }
}

export const TOKEN_VERIFIER = Symbol('TokenVerifierPort')
