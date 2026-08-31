import {
  PasswordChangeError,
  type PasswordChangeOutcome,
  type PasswordChangePort,
} from '../../../application/ports/PasswordChangePort'

/**
 * Doble del cambio de contrasena para desarrollo (`AUTH_MODE=disabled`) y
 * pruebas.
 *
 * Reproduce el CONTRATO del puerto, no la politica del proveedor: exige que la
 * contrasena actual coincida con la ultima conocida para ese testimonio, y por
 * defecto acepta cualquier contrasena nueva. NO decide por longitud cual es
 * debil -esa politica es del pool real-; para probar los resultados
 * `weakPassword` y `PasswordChangeError`, el test los fuerza de forma explicita
 * con `simulateWeakPassword` y `simulateProviderDown`, siguiendo el mismo estilo
 * de dobles configurables que ya usa el repositorio.
 *
 * La contrasena que retiene vive SOLO dentro de este doble, en memoria, y nunca
 * forma parte de `Account` ni de ninguna respuesta. Sin sembrar, no reconoce
 * ninguna credencial: es la raiz de composicion, no el arnes de pruebas, y aqui
 * no hay credenciales de prueba que sembrar.
 */
export class InMemoryPasswordChange implements PasswordChangePort {
  private readonly byToken = new Map<string, string>()
  private providerDown = false
  private weakReason: string | null = null

  /** Registra la contrasena vigente para un testimonio (pruebas y desarrollo). */
  seed(accessToken: string, currentPassword: string): void {
    this.byToken.set(accessToken, currentPassword)
  }

  /**
   * Fuerza que el proveedor no responda: la operacion se propaga como
   * `PasswordChangeError` -> 503, sin confundirse con un rechazo de credencial.
   */
  simulateProviderDown(down = true): void {
    this.providerDown = down
  }

  /**
   * Fuerza que el proveedor rechace la contrasena nueva por su politica, sin que
   * este doble tenga que decidir por longitud cual es debil.
   */
  simulateWeakPassword(
    weak = true,
    reason = 'La contrasena nueva no cumple la politica del proveedor.',
  ): void {
    this.weakReason = weak ? reason : null
  }

  changePassword(
    accessToken: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<PasswordChangeOutcome> {
    if (this.providerDown) {
      return Promise.reject(
        new PasswordChangeError('El proveedor de identidad no respondio (doble en memoria).'),
      )
    }

    const stored = this.byToken.get(accessToken)

    if (stored === undefined || stored !== currentPassword) {
      return Promise.resolve({ kind: 'invalidCurrentPassword' })
    }

    if (this.weakReason !== null) {
      return Promise.resolve({ kind: 'weakPassword', reason: this.weakReason })
    }

    this.byToken.set(accessToken, newPassword)

    return Promise.resolve({ kind: 'changed' })
  }
}
