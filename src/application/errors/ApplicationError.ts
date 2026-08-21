/**
 * Errores de la capa de aplicacion. Describen el resultado del caso de uso sin
 * conocer el protocolo: la traduccion a HTTP ocurre en el adaptador de entrada.
 */
export class AccountAlreadyExistsError extends Error {
  constructor(email: string) {
    super(`Ya existe una cuenta registrada con el correo "${email}".`)
    this.name = 'AccountAlreadyExistsError'
  }
}

export class AccountNotFoundError extends Error {
  constructor(reference: string) {
    super(`No existe una cuenta identificada por "${reference}".`)
    this.name = 'AccountNotFoundError'
  }
}
