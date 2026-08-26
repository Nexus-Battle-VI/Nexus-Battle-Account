/**
 * Puerto hacia el proveedor de identidad.
 *
 * Este servicio no almacena contrasenas. El registro, la revocacion y la
 * verificacion de credenciales pertenecen al proveedor externo.
 *
 * La eleccion del proveedor real y su relacion con un directorio corporativo
 * permanece pendiente de aprobacion. Vease ADR-004 y el blocker de identidad
 * registrado en Nexus-Battle-Infrastructure. En Foundation opera
 * FakeIdentityProvider, que es una implementacion real del puerto sobre
 * almacenamiento en memoria y sin credenciales.
 */
export interface IdentitySubject {
  /** Identificador inmutable del sujeto en el proveedor de identidad. */
  readonly subject: string
  readonly email: string
}

export interface IdentityRegistrationInput {
  readonly email: string
  /**
   * Contrasena en claro. El adaptador la recibe para el alta en el proveedor
   * y no debe persistirla ni registrarla. Cognito sustituira a Fake sin
   * cambiar este contrato.
   */
  readonly password: string
}

export interface IdentityProviderPort {
  /** Da de alta el sujeto y devuelve su identificador en el proveedor. */
  register(input: IdentityRegistrationInput): Promise<IdentitySubject>

  /** Recupera el sujeto asociado a un correo, si existe. */
  findByEmail(email: string): Promise<IdentitySubject | null>

  /** Retira el sujeto del proveedor. */
  revoke(subject: string): Promise<void>
}

export class IdentityProviderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IdentityProviderError'
  }
}

export const IDENTITY_PROVIDER = Symbol('IdentityProviderPort')
