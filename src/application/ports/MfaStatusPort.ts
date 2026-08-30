/** Consulta si una identidad ya confirmo un autenticador TOTP. */
export interface MfaStatusPort {
  hasConfirmedTotp(subject: string): Promise<boolean>
}

/** Cognito no pudo confirmar de forma fiable el estado del segundo factor. */
export class MfaStatusError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MfaStatusError'
  }
}

export const MFA_STATUS = Symbol('MfaStatusPort')
