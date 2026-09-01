import type { RecoveryOtpPort } from '../../../application/ports/RecoveryOtpPort'

/**
 * Codigo fijo para memoria/local, igual que la confirmacion de HU-01 (`000000`).
 * No hay buzon: el caso de uso lo anota en el log como `recovery_otp_issued`.
 */
export class FixedRecoveryOtp implements RecoveryOtpPort {
  static readonly CODE = '000000'

  issue(): string {
    return FixedRecoveryOtp.CODE
  }
}
