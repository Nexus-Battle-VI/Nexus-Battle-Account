/**
 * Ciclo de vida de una cuenta.
 *
 * `PendingVerification` es el estado inicial: la cuenta existe pero todavia no
 * puede autenticarse, porque el correo no ha sido verificado.
 *
 * `Suspended` representa una restriccion temporal de acceso.
 *
 * `Banned` representa una restriccion definitiva derivada de una sancion
 * permanente.
 */
export const AccountStatus = {
  PendingVerification: 'PENDING_VERIFICATION',
  Active: 'ACTIVE',
  Suspended: 'SUSPENDED',
  Banned: 'BANNED',
} as const

export type AccountStatus = (typeof AccountStatus)[keyof typeof AccountStatus]