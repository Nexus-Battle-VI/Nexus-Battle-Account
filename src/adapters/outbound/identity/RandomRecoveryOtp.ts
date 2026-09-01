import { randomInt } from 'node:crypto'

import type { RecoveryOtpPort } from '../../../application/ports/RecoveryOtpPort'

/**
 * Codigo de un solo uso real para HU-04: seis digitos generados con el CSPRNG
 * del proceso (`crypto.randomInt`), distinto en cada `issue()`. Es el
 * contrapunto de `FixedRecoveryOtp` para cuando hay proveedor de identidad
 * real (Cognito): un codigo fijo en produccion seria adivinable por
 * construccion, la misma clase de riesgo por la que `AUTHENTICATION_DRIVER`
 * no admite "fake" con `NODE_ENV=production`.
 */
export class RandomRecoveryOtp implements RecoveryOtpPort {
  issue(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0')
  }
}
