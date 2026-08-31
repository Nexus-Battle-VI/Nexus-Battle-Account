/**
 * Emite el codigo de un solo uso. El valor en claro solo viaja a notificaciones:
 * nunca se persiste, nunca se devuelve en una respuesta de API y nunca se
 * escribe en el registro estructurado (TASK HU-04.3, "no registrar codigos en
 * logs"). Con `AUTHENTICATION_DRIVER=fake` el codigo es el fijo `000000` de
 * `FixedRecoveryOtp`, ya publico en el codigo fuente: no hace falta loguearlo
 * para depurar en local.
 */
export interface RecoveryOtpPort {
  issue(): string
}

export const RECOVERY_OTP = Symbol('RecoveryOtpPort')
