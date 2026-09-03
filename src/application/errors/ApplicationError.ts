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

/**
 * El registro llego sin sujeto verificado.
 *
 * No deberia ocurrir: la ruta exige testimonio y el guard lo comprueba antes de
 * llegar al caso de uso. Existe porque una precondicion que solo vive en la capa
 * HTTP deja de cumplirse en cuanto alguien invoca el caso de uso desde otro
 * sitio, y entonces el fallo seria una cuenta con un sujeto inventado en vez de
 * un error.
 */
export class IdentityAlreadyRegisteredError extends Error {
  constructor() {
    super('Esta identidad ya tiene una cuenta. Inicia sesion en lugar de registrarte.')
    this.name = 'IdentityAlreadyRegisteredError'
  }
}

export class IdentityRequiredError extends Error {
  constructor() {
    super('El registro exige una identidad ya verificada.')
    this.name = 'IdentityRequiredError'
  }
}

export class AuthenticationRequiredError extends Error {
  constructor() {
    super('Se requiere autenticacion.')
    this.name = 'AuthenticationRequiredError'
  }
}

export class AccessDeniedError extends Error {
  constructor() {
    super('Acceso denegado.')
    this.name = 'AccessDeniedError'
  }
}

/**
 * Ya existe una solicitud de eliminacion activa para esta cuenta (HU-43.1).
 *
 * `Received`, `InProgress` y `Failed` cuentan como activas: un fallo
 * transitorio no libera la proteccion, porque la solicitud original sigue
 * pendiente de reintento, no de una nueva solicitud independiente.
 */
export class AccountHasActiveDeletionRequestError extends Error {
  constructor() {
    super('La cuenta ya tiene una solicitud de eliminacion activa.')
    this.name = 'AccountHasActiveDeletionRequestError'
  }
}

/**
 * El titular ya completo su derecho al olvido (HU-43.3 ya cerro la unica
 * solicitud posible sobre esta cuenta). Distinta de
 * `AccountHasActiveDeletionRequestError`: aqui no hay nada en curso que
 * reintentar, el tratamiento ya termino. Sin esta comprobacion, una segunda
 * llamada a `DELETE /accounts/me` sobre una cuenta ya eliminada crearia una
 * solicitud RECEIVED nueva y reenviaria la notificacion de cierre.
 */
export class AccountAlreadyDeletedError extends Error {
  constructor() {
    super('La cuenta ya fue eliminada.')
    this.name = 'AccountAlreadyDeletedError'
  }
}
