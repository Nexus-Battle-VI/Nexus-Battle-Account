/**
 * Fallo generico de recuperacion. El mensaje NO distingue cuenta inexistente,
 * respuestas incorrectas, codigo invalido ni salto de etapa: revelarlo
 * permitiria enumerar cuentas.
 */
export class RecoveryRejectedError extends Error {
  constructor() {
    super('No fue posible continuar con la recuperación. Revisa los datos e inténtalo de nuevo.')
    this.name = 'RecoveryRejectedError'
  }
}

export class RecoveryPasswordResetError extends Error {
  constructor() {
    super('El proveedor de identidad no pudo actualizar la contraseña.')
    this.name = 'RecoveryPasswordResetError'
  }
}
