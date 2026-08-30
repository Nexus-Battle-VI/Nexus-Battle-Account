import type { ConfirmTotpOutcome, TotpEnrollmentPort } from '../ports/TotpEnrollmentPort'

export interface ConfirmTotpEnrollmentCommand {
  readonly accessToken: string
  readonly code: string
}

export interface ConfirmTotpEnrollmentDependencies {
  readonly totpEnrollment: TotpEnrollmentPort
}

/**
 * Segundo paso: verifica el primer codigo del autenticador y deja TOTP como
 * factor preferido.
 *
 * Es delgado a proposito -no hay logica de dominio que anadir-, pero existe como
 * caso de uso para que el controlador dependa de un puerto de aplicacion y no de
 * un adaptador, igual que el resto del servicio. Un `TotpEnrollmentError` del
 * proveedor se propaga tal cual: el controlador lo traduce a 503.
 */
export class ConfirmTotpEnrollment {
  private readonly deps: ConfirmTotpEnrollmentDependencies

  constructor(deps: ConfirmTotpEnrollmentDependencies) {
    this.deps = deps
  }

  execute(command: ConfirmTotpEnrollmentCommand): Promise<ConfirmTotpOutcome> {
    return this.deps.totpEnrollment.confirm(command.accessToken, command.code)
  }
}
