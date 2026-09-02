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

  /**
   * `jti` del testimonio: identifica ESTE token, no a la persona.
   *
   * Es lo que permite ligar la evidencia de segundo factor a un testimonio
   * concreto en lugar de a la cuenta. Ligarla a la cuenta convertiria una
   * prueba de sesion en un atributo duradero, y un testimonio posterior nacido
   * sin segundo factor heredaria la prueba del anterior.
   *
   * `null` cuando no hay testimonio del que extraerlo: es el caso de la
   * identidad anonima, que solo existe sin proveedor configurado.
   */
  readonly jti: string | null

  /**
   * `exp` del testimonio, ya convertido a fecha.
   *
   * La evidencia de segundo factor toma de aqui su vigencia. NO se deriva de
   * una constante: hoy Cognito emite tokens de quince minutos, asi que
   * codificar ese numero acertaria y se desincronizaria en silencio el dia que
   * la configuracion cambie.
   */
  readonly expiresAt: Date | null
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
