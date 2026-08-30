/** Invalida las sesiones que el proveedor mantiene para una identidad. */
export interface SessionRevocationPort {
  globalSignOut(subject: string): Promise<void>
}

export class SessionRevocationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SessionRevocationError'
  }
}

export const SESSION_REVOCATION = Symbol('SessionRevocationPort')
