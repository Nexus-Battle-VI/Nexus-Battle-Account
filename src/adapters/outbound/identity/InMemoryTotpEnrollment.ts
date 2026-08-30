import {
  type ConfirmTotpOutcome,
  type TotpAssociation,
  type TotpEnrollmentPort,
} from '../../../application/ports/TotpEnrollmentPort'

/**
 * Doble de la inscripcion TOTP para desarrollo (`AUTH_MODE=disabled`) y pruebas.
 *
 * Reproduce el contrato COMPLETO: exige `associate` antes de `confirm` y solo
 * acepta el codigo fijo. Si diera todo por confirmado sin asociar, una prueba
 * pasaria contra un comportamiento que produccion no tiene. El secreto y el
 * codigo son fijos y publicos a proposito: no hay proveedor real que consultar.
 */
export class InMemoryTotpEnrollment implements TotpEnrollmentPort {
  static readonly FIXED_SECRET = 'JBSWY3DPEHPK3PXP'
  static readonly FIXED_CODE = '000000'

  private readonly pending = new Set<string>()

  associate(accessToken: string): Promise<TotpAssociation> {
    this.pending.add(accessToken)

    return Promise.resolve({ secret: InMemoryTotpEnrollment.FIXED_SECRET })
  }

  confirm(accessToken: string, code: string): Promise<ConfirmTotpOutcome> {
    // Sin `associate` previo no hay nada que verificar: es el mismo «codigo
    // invalido» que veria quien intenta confirmar sin haber empezado.
    if (!this.pending.has(accessToken)) {
      return Promise.resolve({ kind: 'invalidCode' })
    }

    if (code !== InMemoryTotpEnrollment.FIXED_CODE) {
      return Promise.resolve({ kind: 'invalidCode' })
    }

    this.pending.delete(accessToken)

    return Promise.resolve({ kind: 'confirmed' })
  }
}
