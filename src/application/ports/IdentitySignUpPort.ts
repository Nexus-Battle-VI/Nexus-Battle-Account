/**
 * Da de alta una identidad en el proveedor y confirma su correo.
 *
 * Existe para que el alta ocurra detras de la UI de Web y no en la pantalla
 * alojada de Cognito (ADR-004, «Alta server-side»). Account NO se vuelve la
 * autoridad de identidad: es el mensajero que lleva correo y contrasena al
 * proveedor, que sigue asignando el sujeto, custodiando la contrasena y
 * validando el buzon. La misma relacion que ya tiene con el login.
 *
 * La contrasena viaja por este puerto y no se persiste en ningun sitio de
 * Account: la decision 2 de ADR-004 queda intacta.
 */

export type SignUpOutcome =
  | { readonly kind: 'created'; readonly subject: string }
  /**
   * El correo ya existe en el proveedor. Es distinto de un fallo: la respuesta
   * correcta es un 409, no un 500, y el mensaje debe invitar a iniciar sesion.
   */
  | { readonly kind: 'emailTaken' }

export type ConfirmSignUpOutcome =
  | { readonly kind: 'confirmed' }
  | { readonly kind: 'invalidCode' }
  | { readonly kind: 'expired' }
  /** Ya estaba confirmada: no es un error, no hay nada que hacer. */
  | { readonly kind: 'alreadyConfirmed' }

export interface IdentitySignUpPort {
  /**
   * Crea la identidad en estado no confirmado y pide al proveedor que envie un
   * codigo al correo. Devuelve el sujeto asignado por el proveedor.
   */
  signUp(email: string, password: string): Promise<SignUpOutcome>

  /** Confirma el correo con el codigo que recibio quien se registra. */
  confirmSignUp(email: string, code: string): Promise<ConfirmSignUpOutcome>
}

/**
 * Fallo INESPERADO del proveedor al dar de alta (red, servicio caido, politica
 * de contrasena rechazada por el proveedor). No es «correo ya existe» ni
 * «codigo invalido», que son resultados esperados con su propio `kind`.
 */
export class IdentitySignUpError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IdentitySignUpError'
  }
}

export const IDENTITY_SIGN_UP = Symbol('IdentitySignUpPort')
