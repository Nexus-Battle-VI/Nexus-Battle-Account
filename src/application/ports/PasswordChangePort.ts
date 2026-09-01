/**
 * Cambia la contrasena de la identidad que hace la peticion (HU-05).
 *
 * Deliberadamente ESTRECHO, y no una extension de los puertos de identidad ya
 * existentes: cambiar la contrasena es una operacion propia, con su propia forma
 * de resultado (exito / credencial actual rechazada / nueva rechazada por
 * politica) y su propia superficie de proveedor (Cognito `ChangePassword`). Es
 * el mismo criterio con el que `TokenVerifierPort`, `AuthenticationProviderPort`
 * y `TotpEnrollmentPort` se separaron en lugar de engordar un unico contrato de
 * identidad.
 *
 * Account sigue siendo mensajero, no autoridad: esta operacion actua sobre el
 * propio testimonio de acceso del usuario -igual que la inscripcion TOTP-, que
 * Cognito acepta con el scope `aws.cognito.signin.user.admin` que ya lleva el
 * token emitido por el login de HU-02. NO usa credenciales de AWS ni permiso
 * IAM.
 *
 * La contrasena atraviesa este puerto en claro porque el proveedor externo la
 * necesita para comprobarla y reemplazarla. Ningun adaptador de este puerto debe
 * persistirla, registrarla en logs, devolverla ni incluirla en eventos o
 * telemetria. Account NO gana una columna, un hash ni un campo de instantanea:
 * la credencial vive entera en el proveedor de identidad (ADR-004, decision 2).
 */

export type PasswordChangeOutcome =
  | { readonly kind: 'changed' }
  /** La contrasena actual no corresponde a la identidad del testimonio. */
  | { readonly kind: 'invalidCurrentPassword' }
  /**
   * El proveedor rechazo la contrasena nueva por su politica. Es entrada
   * invalida -400 con el motivo-, no un fallo del proveedor.
   */
  | { readonly kind: 'weakPassword'; readonly reason: string }

export interface PasswordChangePort {
  changePassword(
    accessToken: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<PasswordChangeOutcome>
}

/**
 * Fallo INESPERADO del proveedor al cambiar la contrasena (red, servicio caido,
 * limite de intentos, token sin el scope necesario). No es «credencial actual
 * incorrecta» ni «contrasena nueva debil», que son resultados esperados con su
 * propio `kind`.
 */
export class PasswordChangeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PasswordChangeError'
  }
}

export const PASSWORD_CHANGE = Symbol('PasswordChangePort')
