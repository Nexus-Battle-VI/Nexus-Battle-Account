import {
  AssociateSoftwareTokenCommand,
  CognitoIdentityProviderClient,
  CodeMismatchException,
  EnableSoftwareTokenMFAException,
  NotAuthorizedException,
  SetUserMFAPreferenceCommand,
  VerifySoftwareTokenCommand,
  type VerifySoftwareTokenCommandOutput,
} from '@aws-sdk/client-cognito-identity-provider'

import {
  TotpEnrollmentError,
  type ConfirmTotpOutcome,
  type TotpAssociation,
  type TotpEnrollmentPort,
} from '../../../application/ports/TotpEnrollmentPort'

export interface CognitoTotpEnrollmentOptions {
  /** Solo se usa para derivar la region: estas operaciones no piden el pool. */
  readonly userPoolId: string
}

/**
 * Inscripcion TOTP sobre las operaciones self-service de Cognito.
 *
 * `AssociateSoftwareToken`, `VerifySoftwareToken` y `SetUserMFAPreference`
 * actuan sobre el `AccessToken` del propio usuario, NO sobre `AdminSetUserMFA*`:
 * no piden `UserPoolId`, `ClientId` ni credenciales de AWS. El token del login
 * de HU-02 -emitido por `AdminInitiateAuth`- lleva el scope
 * `aws.cognito.signin.user.admin` que Cognito exige para estas tres. El cliente
 * se construye solo con `region` y firma con la cadena por defecto del SDK solo
 * cuando hace falta; aqui la autorizacion la lleva el propio token.
 */
export class CognitoTotpEnrollment implements TotpEnrollmentPort {
  private readonly client: CognitoIdentityProviderClient

  constructor(options: CognitoTotpEnrollmentOptions) {
    this.client = new CognitoIdentityProviderClient({
      region: CognitoTotpEnrollment.regionOf(options.userPoolId),
    })
  }

  async associate(accessToken: string): Promise<TotpAssociation> {
    let secret: string | undefined

    try {
      const response = await this.client.send(
        new AssociateSoftwareTokenCommand({ AccessToken: accessToken }),
      )
      secret = response.SecretCode
    } catch (error: unknown) {
      throw new TotpEnrollmentError(CognitoTotpEnrollment.describeUnexpected(error))
    }

    if (secret === undefined || secret.length === 0) {
      throw new TotpEnrollmentError('Cognito no devolvio una clave TOTP para asociar.')
    }

    return { secret }
  }

  async confirm(accessToken: string, code: string): Promise<ConfirmTotpOutcome> {
    let verification: VerifySoftwareTokenCommandOutput

    try {
      verification = await this.client.send(
        new VerifySoftwareTokenCommand({
          AccessToken: accessToken,
          UserCode: code,
          FriendlyDeviceName: 'Nexus Battles VI',
        }),
      )
    } catch (error: unknown) {
      /**
       * Un codigo equivocado es un resultado ESPERADO, no un fallo del
       * proveedor: Cognito lo senala con `CodeMismatch` o
       * `EnableSoftwareTokenMFA` ("Code mismatch..."). Se distingue para que
       * quien llama reciba un 400 con motivo, no un 503.
       */
      if (
        error instanceof CodeMismatchException ||
        error instanceof EnableSoftwareTokenMFAException
      ) {
        return { kind: 'invalidCode' }
      }

      throw new TotpEnrollmentError(CognitoTotpEnrollment.describeUnexpected(error))
    }

    // El SDK tambien puede devolver `Status: "ERROR"` sin lanzar. Se trata igual
    // que un codigo invalido: no se deja el factor a medio activar.
    if (verification.Status !== 'SUCCESS') {
      return { kind: 'invalidCode' }
    }

    try {
      await this.client.send(
        new SetUserMFAPreferenceCommand({
          AccessToken: accessToken,
          SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true },
        }),
      )
    } catch (error: unknown) {
      throw new TotpEnrollmentError(CognitoTotpEnrollment.describeUnexpected(error))
    }

    return { kind: 'confirmed' }
  }

  /**
   * Nunca incluye el codigo ni el testimonio: el `error` del SDK no los contiene
   * -van en la peticion, no en la respuesta-, pero el mensaje se arma a partir
   * de campos conocidos y no volcando el objeto completo.
   */
  private static describeUnexpected(error: unknown): string {
    if (error instanceof NotAuthorizedException) {
      return 'El testimonio no autoriza inscribir un autenticador (scope o token no validos).'
    }

    if (error instanceof Error) {
      return `El proveedor de identidad respondio con un error inesperado: ${error.name}.`
    }

    return 'El proveedor de identidad respondio con un error inesperado.'
  }

  private static regionOf(userPoolId: string): string {
    const region = userPoolId.split('_')[0]

    if (region === undefined || region.length === 0) {
      throw new TotpEnrollmentError(
        `COGNITO_USER_POOL_ID "${userPoolId}" no tiene el formato esperado "<region>_<id>".`,
      )
    }

    return region
  }
}
