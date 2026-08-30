import { isAdministrativeRole, type Role } from '../entities/Role'
import { SecondFactorMethod } from '../../application/ports/AuthenticationProviderPort'

/**
 * Que segundo factor admite cada clase de cuenta.
 *
 * EL PROVEEDOR NO PUEDE HACER ESTA DISTINCION. `mfa_configuration` es del pool
 * entero: Cognito ofrece los mismos factores a todo el mundo y lo unico que
 * varia es cual tiene inscrito cada persona. Confiar en eso seria confiar en
 * una convencion, no en un control: bastaria con que un administrador
 * inscribiera el correo para que su segundo factor pasara a depender del mismo
 * buzon.
 *
 * Account SI puede distinguir, porque conoce el rol: la fuente de verdad es
 * `account_roles`, no el testimonio. Por eso la regla vive aqui.
 *
 * Decision de producto: **la aplicacion autenticadora para las cuentas
 * administrativas, el correo para los usuarios finales.** El motivo de la
 * primera mitad no es preferencia: un codigo por correo lo intercepta quien
 * tenga el correo, y el correo es ademas la via de recuperacion de la cuenta.
 * Para un rol que puede administrar el sistema entero, eso deja el segundo
 * factor colgando del mismo hilo que el primero.
 */
export const SecondFactorPolicy = {
  /** Factores que una cuenta con estos roles puede usar. */
  allowedFor(roles: Iterable<Role>): readonly SecondFactorMethod[] {
    if (isAdministrativeRole(roles)) {
      return [SecondFactorMethod.AuthenticatorApp]
    }

    // Los usuarios finales pueden usar cualquiera de los que el proveedor
    // ofrezca. No se enumeran aqui para no tener que actualizar esta lista cada
    // vez que el pool gane un mecanismo.
    return [SecondFactorMethod.AuthenticatorApp, SecondFactorMethod.Email, SecondFactorMethod.Sms]
  },

  /** Si esta cuenta puede completar el segundo factor por este medio. */
  permits(roles: Iterable<Role>, method: SecondFactorMethod): boolean {
    return SecondFactorPolicy.allowedFor(roles).includes(method)
  },

  /**
   * Recorta lo que el proveedor ofrece a lo que la politica permite.
   *
   * Devolver una lista vacia es un resultado legitimo y significa algo
   * concreto: la cuenta NO tiene ningun factor admisible inscrito. Quien llame
   * debe tratarlo como imposibilidad de autenticar, nunca como "ofrece todo".
   */
  narrow(
    roles: Iterable<Role>,
    offered: readonly SecondFactorMethod[],
  ): readonly SecondFactorMethod[] {
    const permitidos = SecondFactorPolicy.allowedFor(roles)

    return offered.filter((method) => permitidos.includes(method))
  },
} as const
