export type PasswordResetOutcome = { readonly kind: 'updated' } | { readonly kind: 'failed' }

/**
 * Cambia la credencial en el proveedor. Account no almacena contrasenas.
 */
export interface IdentityPasswordResetPort {
  setPassword(email: string, password: string): Promise<PasswordResetOutcome>
}

export const IDENTITY_PASSWORD_RESET = Symbol('IdentityPasswordResetPort')
