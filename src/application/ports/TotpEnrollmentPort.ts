/**
 * Inscribe un autenticador TOTP para la identidad que hace la peticion.
 *
 * Segundo factor administrativo por aplicacion autenticadora (decision de
 * producto del 2026-08-29, aceptada por el PO). La inscripcion ocurre DENTRO de
 * la UI del producto -no en un script de operador ni en la pantalla alojada del
 * proveedor- para que sea autoservicio.
 *
 * Account sigue siendo mensajero, no autoridad: estas operaciones actuan sobre
 * el propio testimonio de acceso del usuario (`AssociateSoftwareToken`,
 * `VerifySoftwareToken`, `SetUserMFAPreference`), que Cognito acepta con el
 * scope `aws.cognito.signin.user.admin` que ya lleva el token emitido por el
 * login de HU-02. NO usa credenciales de AWS ni permiso IAM.
 *
 * IMPORTANTE: inscribir un factor NO eleva el rol. Un PLAYER puede inscribir su
 * TOTP -es justo el orden que exige el gobierno: inscribir siendo PLAYER y
 * elevar despues (HU-39)-. Este puerto no toca `account_roles` ni los grupos.
 */

export interface TotpAssociation {
  /**
   * La clave compartida en base32. Es una CREDENCIAL: quien la tenga genera los
   * codigos. Viaja una sola vez, para que quien se inscribe la meta en su
   * autenticador, y no se persiste en ningun sitio de Account.
   */
  readonly secret: string
}

export type ConfirmTotpOutcome =
  | { readonly kind: 'confirmed' }
  /** El codigo no coincide con el secreto recien asociado, o el reloj derivo. */
  | { readonly kind: 'invalidCode' }

export interface TotpEnrollmentPort {
  /**
   * Asocia un nuevo autenticador y devuelve el secreto a inscribir. Idempotente
   * hasta que se verifica: repetir `associate` antes de confirmar entrega otro
   * secreto y descarta el anterior sin confirmar.
   */
  associate(accessToken: string): Promise<TotpAssociation>

  /**
   * Verifica el primer codigo del autenticador y, si es valido, deja TOTP como
   * factor preferido. Recien entonces Cognito lo exigira en el proximo login.
   */
  confirm(accessToken: string, code: string): Promise<ConfirmTotpOutcome>
}

/**
 * Fallo INESPERADO del proveedor al inscribir (red, servicio caido, token sin
 * el scope necesario). No es «codigo invalido», que es un resultado esperado
 * con su propio `kind`.
 */
export class TotpEnrollmentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TotpEnrollmentError'
  }
}

export const TOTP_ENROLLMENT = Symbol('TotpEnrollmentPort')
