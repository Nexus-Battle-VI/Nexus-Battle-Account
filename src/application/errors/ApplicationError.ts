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

export class DisplayNameAlreadyTakenError extends Error {
  constructor(displayName: string) {
    super(`Ya existe una cuenta registrada con el apodo "${displayName}".`)
    this.name = 'DisplayNameAlreadyTakenError'
  }
}

export class NicknameBlacklistedError extends Error {
  constructor() {
    super('El apodo no esta permitido por la lista negra vigente.')
    this.name = 'NicknameBlacklistedError'
  }
}

export class AccountNotFoundError extends Error {
  /**
   * Lo que se buscaba. Se conserva aparte del mensaje porque no siempre puede
   * devolverse: un identificador que el cliente acaba de enviar puede repetirse
   * en la respuesta, pero el sujeto del testimonio es un vinculo interno con el
   * proveedor de identidad y no tiene por que salir del servicio. Sigue estando
   * disponible para el registro, que es donde hace falta.
   */
  readonly reference: string

  constructor(
    reference: string,
    message = `No existe una cuenta identificada por "${reference}".`,
  ) {
    super(message)
    this.name = 'AccountNotFoundError'
    this.reference = reference
  }
}
