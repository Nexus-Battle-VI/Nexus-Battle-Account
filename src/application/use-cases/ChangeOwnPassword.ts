import type { PasswordChangeOutcome, PasswordChangePort } from '../ports/PasswordChangePort'

export interface ChangeOwnPasswordDependencies {
  readonly passwords: PasswordChangePort
}

/**
 * Cambia la contrasena de la cuenta propia (HU-05).
 *
 * No carga ni modifica `Account` ni consulta PostgreSQL: la contrasena no
 * pertenece al agregado. El caso de uso solo traslada la peticion al proveedor
 * de identidad a traves del puerto.
 *
 * La autorizacion la lleva el propio testimonio de acceso -verificado ya por el
 * guard antes de llegar aqui-, no un identificador del cuerpo. No recibe
 * `subject` porque no aportaria seguridad: quien opera es el titular del token,
 * y es el token lo que el proveedor exige.
 *
 * La POLITICA de complejidad la aplica el proveedor, igual que en el alta
 * (HU-01): este servicio no la duplica. Un rechazo de politica llega como
 * `weakPassword` y se traduce a 400 con el motivo.
 */
export class ChangeOwnPassword {
  private readonly passwords: PasswordChangePort

  constructor(deps: ChangeOwnPasswordDependencies) {
    this.passwords = deps.passwords
  }

  execute(command: {
    readonly accessToken: string
    readonly currentPassword: string
    readonly newPassword: string
  }): Promise<PasswordChangeOutcome> {
    return this.passwords.changePassword(
      command.accessToken,
      command.currentPassword,
      command.newPassword,
    )
  }
}
