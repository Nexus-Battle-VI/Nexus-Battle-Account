import type { SessionRevocationPort } from '../ports/SessionRevocationPort'

export interface LogoutAccountCommand {
  readonly subject: string
}

/**
 * Cierra la sesion activa de una identidad autenticada (HU-03).
 *
 * Delega la invalidacion global en el proveedor de identidad a traves de
 * `SessionRevocationPort`. El sujeto proviene del contexto autenticado (JWT
 * verificado), garantizando que nadie pueda revocar la sesion de otra identidad.
 */
export class LogoutAccount {
  constructor(private readonly sessionRevocation: SessionRevocationPort) {}

  async execute(command: LogoutAccountCommand): Promise<void> {
    await this.sessionRevocation.globalSignOut(command.subject)
  }
}
