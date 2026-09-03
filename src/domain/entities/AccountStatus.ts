/**
 * Ciclo de vida de una cuenta.
 *
 * `PendingVerification` es el estado inicial: la cuenta existe pero todavia no
 * puede autenticarse, porque el correo no ha sido verificado.
 */
export const AccountStatus = {
  PendingVerification: 'PENDING_VERIFICATION',
  Active: 'ACTIVE',
  Suspended: 'SUSPENDED',
  /**
   * Terminal. La cuenta ejecuto el tratamiento de HU-43.3: sus datos propios
   * quedaron anonimizados y no admite ninguna otra transicion.
   */
  Deleted: 'DELETED',
} as const

export type AccountStatus = (typeof AccountStatus)[keyof typeof AccountStatus]
