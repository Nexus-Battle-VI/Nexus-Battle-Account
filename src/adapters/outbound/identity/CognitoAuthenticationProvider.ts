import {
  AdminInitiateAuthCommand,
  AdminRespondToAuthChallengeCommand,
  AuthFlowType,
  ChallengeNameType,
  CodeMismatchException,
  CognitoIdentityProviderClient,
  ExpiredCodeException,
  NotAuthorizedException,
  PasswordResetRequiredException,
  UserNotConfirmedException,
  UserNotFoundException,
  type AdminInitiateAuthCommandOutput,
  type AdminRespondToAuthChallengeCommandOutput,
  type AuthenticationResultType,
} from '@aws-sdk/client-cognito-identity-provider'

import {
  AuthenticationProviderError,
  SecondFactorMethod,
  type AuthenticationCredentials,
  type AuthenticationOutcome,
  type AuthenticationProviderPort,
  type SecondFactorOutcome,
  type SecondFactorSelection,
  type SecondFactorVerification,
} from '../../../application/ports/AuthenticationProviderPort'

export interface CognitoAuthenticationProviderOptions {
  readonly userPoolId: string
  readonly clientId: string
}

/**
 * Parametro de `ChallengeResponses` que lleva el codigo, segun el reto que
 * Cognito haya emitido. Vease ADR-004: el pool tiene TOTP aprovisionado
 * (`SOFTWARE_TOKEN_MFA`) porque el MFA por correo exige SES, decision
 * pendiente. Se listan tambien SMS y correo para no tener que tocar este
 * adaptador el dia que esa decision cambie: el puerto ya es agnostico al
 * transporte, y aqui solo hace falta saber como se llama el campo.
 *
 * Es tambien la lista COMPLETA de retos que HU-02 sabe resolver con "un
 * codigo". Cualquier `ChallengeName` que Cognito emita y no este aqui -por
 * ejemplo `NEW_PASSWORD_REQUIRED`, `MFA_SETUP` o `SELECT_MFA_TYPE`, que no son
 * "ingresa un codigo" sino flujos con forma propia- se trata como fallo del
 * proveedor, nunca como `challengeRequired`. Fingir que Web puede resolverlos
 * con el mismo formulario de codigo seria inventar un flujo que nadie aprobo.
 */
const CHALLENGE_CODE_PARAMETER: Partial<Record<ChallengeNameType, string>> = {
  [ChallengeNameType.SOFTWARE_TOKEN_MFA]: 'SOFTWARE_TOKEN_MFA_CODE',
  [ChallengeNameType.SMS_MFA]: 'SMS_MFA_CODE',
  [ChallengeNameType.EMAIL_OTP]: 'EMAIL_OTP_CODE',
}

/**
 * Donde tiene que mirar quien responde el reto.
 *
 * Se declara junto al mapa de arriba y no aparte: las dos tablas describen el
 * mismo conjunto de retos, y separarlas invita a que una crezca sin la otra.
 */
/**
 * Nombre con el que Cognito conoce cada metodo al RESPONDER una seleccion.
 *
 * Es la inversa de `CHALLENGE_METHOD`, escrita a mano y no derivada: derivarla
 * daria un mapa cuyo contenido depende del orden de las claves, y aqui lo que
 * se manda a AWS tiene que ser literal y evidente al leerlo.
 */
const METHOD_CHALLENGE_NAME: Record<SecondFactorMethod, ChallengeNameType> = {
  [SecondFactorMethod.AuthenticatorApp]: ChallengeNameType.SOFTWARE_TOKEN_MFA,
  [SecondFactorMethod.Sms]: ChallengeNameType.SMS_MFA,
  [SecondFactorMethod.Email]: ChallengeNameType.EMAIL_OTP,
}

const CHALLENGE_METHOD: Partial<Record<ChallengeNameType, SecondFactorMethod>> = {
  [ChallengeNameType.SOFTWARE_TOKEN_MFA]: SecondFactorMethod.AuthenticatorApp,
  [ChallengeNameType.SMS_MFA]: SecondFactorMethod.Sms,
  [ChallengeNameType.EMAIL_OTP]: SecondFactorMethod.Email,
}

/**
 * Adaptador real de `AuthenticationProviderPort` sobre Amazon Cognito.
 *
 * Usa `AdminInitiateAuth`/`AdminRespondToAuthChallenge` (`AuthFlow:
 * ADMIN_USER_PASSWORD_AUTH`), NO las variantes publicas `InitiateAuth`/
 * `RespondToAuthChallenge`. Es una decision deliberada, no la primera que se
 * probo aqui:
 *
 * El cliente de app de Cognito (ADR-004) es el mismo cliente PUBLICO que usa
 * Web por Authorization Code + PKCE. Si este adaptador usara el flujo publico
 * `USER_PASSWORD_AUTH`, habilitarlo en ese cliente (`ALLOW_USER_PASSWORD_AUTH`)
 * permitiria a CUALQUIER cliente que conozca el Client ID -que no es secreto,
 * viaja en la URL de login- autenticar DIRECTAMENTE contra Cognito, saltandose
 * `LoginAccount` por completo. Eso es inaceptable para HU-02 especificamente
 * porque la regla de que `ADMINISTRATOR`/`SUPER_ADMINISTRATOR` no obtienen
 * acceso administrativo solo con contrasena VIVE en `LoginAccount`, no en
 * Cognito: saltarselo saltaria esa regla.
 *
 * El flujo `Admin*` no tiene ese problema: `ALLOW_ADMIN_USER_PASSWORD_AUTH` es
 * un flag DISTINTO de `ALLOW_USER_PASSWORD_AUTH` en `ExplicitAuthFlows`, y las
 * operaciones `Admin*` exigen credenciales de AWS firmadas (IAM), que un
 * navegador o un cliente arbitrario no tiene. Solo el runtime de Account -con
 * permiso IAM explicito, vease el reporte de esta task- puede invocarlas. El
 * camino queda forzado a Web -> Account -> Cognito, no Web -> Cognito directo.
 *
 * Tampoco se implementa SRP a mano: seria la misma clase de criptografia que
 * `CognitoTokenVerifier` evita reimplementar para la verificacion de firma.
 *
 * Tanto `AdminInitiateAuth` como `AdminRespondToAuthChallenge` SI necesitan
 * SigV4 (a diferencia de sus variantes publicas): el cliente se construye solo
 * con `region` y se apoya en la cadena de credenciales por defecto del SDK
 * (variable de entorno, rol de tarea/instancia). Nunca se pasan claves de
 * acceso de AWS de forma explicita.
 */
export class CognitoAuthenticationProvider implements AuthenticationProviderPort {
  private readonly client: CognitoIdentityProviderClient
  private readonly userPoolId: string
  private readonly clientId: string

  constructor(options: CognitoAuthenticationProviderOptions) {
    this.userPoolId = options.userPoolId
    this.clientId = options.clientId
    this.client = new CognitoIdentityProviderClient({
      region: CognitoAuthenticationProvider.regionOf(options.userPoolId),
    })
  }

  async authenticate(credentials: AuthenticationCredentials): Promise<AuthenticationOutcome> {
    let response: AdminInitiateAuthCommandOutput

    try {
      response = await this.client.send(
        new AdminInitiateAuthCommand({
          UserPoolId: this.userPoolId,
          ClientId: this.clientId,
          AuthFlow: AuthFlowType.ADMIN_USER_PASSWORD_AUTH,
          AuthParameters: { USERNAME: credentials.email, PASSWORD: credentials.password },
        }),
      )
    } catch (error: unknown) {
      return CognitoAuthenticationProvider.translateAuthenticationError(error)
    }

    if (response.ChallengeName !== undefined) {
      return CognitoAuthenticationProvider.packSupportedChallenge(
        response.ChallengeName,
        response.Session,
        response.ChallengeParameters,
      )
    }

    const { accessToken, expiresIn } = CognitoAuthenticationProvider.unpackAuthenticationResult(
      response.AuthenticationResult,
    )

    return { kind: 'authenticated', accessToken, expiresIn }
  }

  /**
   * Responde el reto de seleccion, y devuelve el reto del factor elegido.
   *
   * Cognito espera el NOMBRE de su reto en `ANSWER`, no el nombre que usa este
   * dominio. La traduccion vive en `METHOD_CHALLENGE_NAME` y no se deduce del
   * texto: mandar un valor que Cognito no reconoce produce un error generico
   * que no dice cual de las dos partes se equivoco.
   */
  async chooseSecondFactor(input: SecondFactorSelection): Promise<AuthenticationOutcome> {
    const unpacked = CognitoAuthenticationProvider.unpackChallengeToken(input.challengeToken)

    if (unpacked?.challengeName !== ChallengeNameType.SELECT_MFA_TYPE) {
      throw new AuthenticationProviderError(
        'El testimonio de reto no corresponde a una seleccion de factor pendiente.',
      )
    }

    let response: AdminRespondToAuthChallengeCommandOutput

    try {
      response = await this.client.send(
        new AdminRespondToAuthChallengeCommand({
          UserPoolId: this.userPoolId,
          ClientId: this.clientId,
          ChallengeName: ChallengeNameType.SELECT_MFA_TYPE,
          Session: unpacked.session,
          ChallengeResponses: {
            USERNAME: input.email,
            ANSWER: METHOD_CHALLENGE_NAME[input.method],
          },
        }),
      )
    } catch (error: unknown) {
      return CognitoAuthenticationProvider.translateAuthenticationError(error)
    }

    if (response.ChallengeName === undefined) {
      throw new AuthenticationProviderError(
        'Cognito acepto la seleccion de factor sin emitir ningun reto: respuesta inesperada.',
      )
    }

    return CognitoAuthenticationProvider.packSupportedChallenge(
      response.ChallengeName,
      response.Session,
      response.ChallengeParameters,
    )
  }

  async verifySecondFactor(input: SecondFactorVerification): Promise<SecondFactorOutcome> {
    const unpacked = CognitoAuthenticationProvider.unpackChallengeToken(input.challengeToken)

    if (unpacked === null) {
      return { kind: 'challengeExpired' }
    }

    // El reto ya se clasifico como soportado al empaquetarlo en `authenticate`
    // (`packSupportedChallenge`), asi que este parametro siempre existe aqui.
    // Se comprueba igual, sin asumir: un `challengeToken` con un nombre que
    // esta suite nunca emitio -por ejemplo, uno construido a mano- no debe
    // llegar a llamar a Cognito con un `ChallengeResponses` inventado.
    const codeParameter = CHALLENGE_CODE_PARAMETER[unpacked.challengeName]
    const method = CHALLENGE_METHOD[unpacked.challengeName]

    if (codeParameter === undefined || method === undefined) {
      throw new AuthenticationProviderError(
        `El reto "${unpacked.challengeName}" no tiene codigo y metodo conocidos por este adaptador.`,
      )
    }

    let response: AdminRespondToAuthChallengeCommandOutput

    try {
      response = await this.client.send(
        new AdminRespondToAuthChallengeCommand({
          UserPoolId: this.userPoolId,
          ClientId: this.clientId,
          ChallengeName: unpacked.challengeName,
          Session: unpacked.session,
          ChallengeResponses: { USERNAME: input.email, [codeParameter]: input.code },
        }),
      )
    } catch (error: unknown) {
      return CognitoAuthenticationProvider.translateChallengeError(error)
    }

    // Un segundo reto encadenado (poco comun con un unico factor de MFA) no
    // esta contemplado por HU-02: `unpackAuthenticationResult` lo trata como
    // fallo del proveedor en lugar de inventar una cadena de retos que nadie
    // ha aprobado.
    const { accessToken, expiresIn } = CognitoAuthenticationProvider.unpackAuthenticationResult(
      response.AuthenticationResult,
    )

    return { kind: 'verified', accessToken, expiresIn, method }
  }

  /**
   * Clasifica el reto ANTES de convertirlo en `challengeRequired`: solo los
   * retos que HU-02 sabe resolver con un unico codigo (`CHALLENGE_CODE_PARAMETER`)
   * llegan a Web como "segundo factor requerido". Cualquier otro
   * -`NEW_PASSWORD_REQUIRED`, `MFA_SETUP`, `SELECT_MFA_TYPE`, `WEB_AUTHN`,
   * etc.- exige un flujo que HU-02 no define, y fingir que un formulario de
   * codigo lo resuelve seria inventar comportamiento no aprobado. Se falla
   * cerrado con `AuthenticationProviderError` en lugar de intentarlo.
   */
  private static packSupportedChallenge(
    challengeName: ChallengeNameType,
    session: string | undefined,
    parameters?: Record<string, string>,
  ): AuthenticationOutcome {
    if (challengeName === ChallengeNameType.SELECT_MFA_TYPE) {
      if (session === undefined) {
        throw new AuthenticationProviderError(
          'Cognito emitio un reto sin sesion asociada: respuesta inesperada.',
        )
      }

      return {
        kind: 'selectionRequired',
        challengeToken: CognitoAuthenticationProvider.packChallengeToken(challengeName, session),
        methods: CognitoAuthenticationProvider.readSelectableMethods(parameters),
      }
    }

    if (CHALLENGE_CODE_PARAMETER[challengeName] === undefined) {
      throw new AuthenticationProviderError(
        `Cognito exige el reto "${challengeName}", que HU-02 no tiene definido como segundo factor.`,
      )
    }

    if (session === undefined) {
      throw new AuthenticationProviderError(
        'Cognito emitio un reto sin sesion asociada: respuesta inesperada.',
      )
    }

    const method = CHALLENGE_METHOD[challengeName]

    if (method === undefined) {
      throw new AuthenticationProviderError(
        `El reto "${challengeName}" no declara donde mirar para responderlo.`,
      )
    }

    return {
      kind: 'challengeRequired',
      challengeToken: CognitoAuthenticationProvider.packChallengeToken(challengeName, session),
      method,
    }
  }

  /**
   * Factores que Cognito ofrece elegir, en `MFAS_CAN_CHOOSE`.
   *
   * Llega como un JSON dentro de un campo de texto, y se valida en lugar de
   * confiar: un metodo que este adaptador no sabe responder se DESCARTA aqui.
   * Ofrecerlo obligaria a la persona a elegir un camino que despues fallaria.
   *
   * Si no queda ninguno, es un fallo del proveedor y no una lista vacia: pedir
   * que se elija entre nada no es un estado que la interfaz pueda representar.
   */
  private static readSelectableMethods(
    parameters: Record<string, string> | undefined,
  ): readonly SecondFactorMethod[] {
    const crudo = parameters?.MFAS_CAN_CHOOSE

    if (crudo === undefined) {
      throw new AuthenticationProviderError(
        'Cognito pidio elegir factor sin decir entre cuales (falta MFAS_CAN_CHOOSE).',
      )
    }

    let nombres: unknown

    try {
      nombres = JSON.parse(crudo)
    } catch {
      throw new AuthenticationProviderError('MFAS_CAN_CHOOSE no es una lista JSON valida.')
    }

    if (!Array.isArray(nombres)) {
      throw new AuthenticationProviderError('MFAS_CAN_CHOOSE no es una lista.')
    }

    const metodos = nombres
      .filter((nombre): nombre is string => typeof nombre === 'string')
      .map((nombre) => CHALLENGE_METHOD[nombre as ChallengeNameType])
      .filter((metodo): metodo is SecondFactorMethod => metodo !== undefined)

    if (metodos.length === 0) {
      throw new AuthenticationProviderError(
        'Cognito ofrecio elegir entre factores que este adaptador no sabe responder.',
      )
    }

    return metodos
  }

  /**
   * `challengeToken` es opaco para el resto de la aplicacion (vease
   * `AuthenticationProviderPort`). Este adaptador es el unico que sabe que,
   * para responder un reto, Cognito exige tanto el `Session` como el
   * `ChallengeName` que lo origino -`AdminRespondToAuthChallenge` los pide por
   * separado-, asi que empaqueta ambos aqui sin tocar el contrato del puerto.
   */
  private static packChallengeToken(challengeName: ChallengeNameType, session: string): string {
    return `${challengeName}:${session}`
  }

  private static unpackChallengeToken(
    challengeToken: string,
  ): { challengeName: ChallengeNameType; session: string } | null {
    const separator = challengeToken.indexOf(':')

    if (separator <= 0) {
      return null
    }

    const challengeName = challengeToken.slice(0, separator)
    const session = challengeToken.slice(separator + 1)

    if (!Object.values(ChallengeNameType).includes(challengeName as ChallengeNameType)) {
      return null
    }

    return { challengeName: challengeName as ChallengeNameType, session }
  }

  private static translateAuthenticationError(error: unknown): AuthenticationOutcome {
    if (
      error instanceof NotAuthorizedException ||
      error instanceof UserNotFoundException ||
      error instanceof PasswordResetRequiredException ||
      error instanceof UserNotConfirmedException
    ) {
      // Deliberadamente el mismo resultado para las cuatro causas: distinguir
      // "no existe", "contrasena incorrecta", "requiere restablecer" o "no
      // confirmada" permitiria enumerar el estado de una cuenta en Cognito.
      return { kind: 'invalidCredentials' }
    }

    throw new AuthenticationProviderError(CognitoAuthenticationProvider.describeUnexpected(error))
  }

  private static translateChallengeError(error: unknown): SecondFactorOutcome {
    if (error instanceof CodeMismatchException) {
      return { kind: 'invalidCode' }
    }

    if (error instanceof ExpiredCodeException || error instanceof NotAuthorizedException) {
      // `NotAuthorizedException` aqui tipicamente significa sesion de reto
      // vencida o ya usada: se trata igual que un reto expirado.
      return { kind: 'challengeExpired' }
    }

    throw new AuthenticationProviderError(CognitoAuthenticationProvider.describeUnexpected(error))
  }

  /**
   * Nunca incluye la contrasena, el codigo ni el testimonio: el `error` de
   * AWS SDK no los contiene (van en la peticion, no en la respuesta), pero
   * se construye el mensaje explicitamente a partir de campos conocidos y no
   * volcando el objeto completo, para no arrastrar aqui algo inesperado.
   */
  private static describeUnexpected(error: unknown): string {
    if (error instanceof Error) {
      return `El proveedor de identidad respondio con un error inesperado: ${error.name}.`
    }

    return 'El proveedor de identidad respondio con un error inesperado.'
  }

  private static unpackAuthenticationResult(result: AuthenticationResultType | undefined): {
    accessToken: string
    expiresIn: number
  } {
    if (result?.AccessToken === undefined || result.ExpiresIn === undefined) {
      throw new AuthenticationProviderError(
        'Cognito no devolvio un testimonio de acceso completo: respuesta inesperada.',
      )
    }

    return { accessToken: result.AccessToken, expiresIn: result.ExpiresIn }
  }

  private static regionOf(userPoolId: string): string {
    const region = userPoolId.split('_')[0]

    if (region === undefined || region.length === 0) {
      throw new AuthenticationProviderError(
        `COGNITO_USER_POOL_ID "${userPoolId}" no tiene el formato esperado "<region>_<id>".`,
      )
    }

    return region
  }
}
