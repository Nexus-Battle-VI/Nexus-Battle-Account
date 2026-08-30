import type { AccountRepositoryPort } from '../ports/AccountRepositoryPort'
import type { TotpEnrollmentPort } from '../ports/TotpEnrollmentPort'

/** Marca que el autenticador muestra junto al codigo. No es un secreto. */
const ISSUER = 'Nexus Battles VI'

export interface EnrollTotpCommand {
  /** Testimonio de acceso del propio usuario; autoriza la operacion en Cognito. */
  readonly accessToken: string
  /** Sujeto verificado, para etiquetar el autenticador con su correo. */
  readonly subject: string
}

export interface EnrollTotpResult {
  /** Clave base32 a introducir a mano si no se escanea el QR. Es una credencial. */
  readonly secret: string
  /** URI `otpauth://` que Web convierte en QR. Contiene el mismo secreto. */
  readonly otpauthUri: string
}

export interface EnrollTotpDependencies {
  readonly totpEnrollment: TotpEnrollmentPort
  readonly accounts: AccountRepositoryPort
}

/**
 * Primer paso de la inscripcion TOTP: asocia un autenticador y devuelve el
 * secreto para inscribirlo.
 *
 * El correo se usa SOLO como etiqueta del autenticador (lo que la app muestra
 * junto al codigo); si el sujeto no tuviera cuenta -no deberia, la ruta exige
 * testimonio- se cae al propio sujeto. La inscripcion en el proveedor no depende
 * de esa cuenta: actua sobre el testimonio, no sobre la fila de la base.
 */
export class EnrollTotp {
  private readonly deps: EnrollTotpDependencies

  constructor(deps: EnrollTotpDependencies) {
    this.deps = deps
  }

  async execute(command: EnrollTotpCommand): Promise<EnrollTotpResult> {
    const account = await this.deps.accounts.findBySubject(command.subject)
    const label = account?.currentEmail.value ?? command.subject

    const { secret } = await this.deps.totpEnrollment.associate(command.accessToken)

    return { secret, otpauthUri: EnrollTotp.buildOtpauthUri(label, secret) }
  }

  /**
   * Formato `otpauth://totp/` estandar (Key Uri Format). TOTP de Cognito usa
   * SHA1, 6 digitos y periodo de 30 s; se declaran de forma explicita para que
   * el autenticador no dependa de sus valores por defecto. Etiqueta y emisor se
   * codifican para URL; el secreto es base32 y no necesita codificarse.
   */
  private static buildOtpauthUri(label: string, secret: string): string {
    const issuer = encodeURIComponent(ISSUER)
    const account = encodeURIComponent(label)

    return `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`
  }
}
