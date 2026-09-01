import {
  ChangePasswordCommand,
  CognitoIdentityProviderClient,
  InvalidPasswordException,
  LimitExceededException,
  NotAuthorizedException,
  TooManyRequestsException,
} from '@aws-sdk/client-cognito-identity-provider'

import {
  PasswordChangeError,
  type PasswordChangeOutcome,
  type PasswordChangePort,
} from '../../../application/ports/PasswordChangePort'

export interface CognitoPasswordChangeOptions {
  /** Solo se usa para derivar la region: esta operacion self-service no pide el pool. */
  readonly userPoolId: string
}

/**
 * Cambio de contrasena sobre la operacion self-service de Cognito.
 *
 * `ChangePassword` actua sobre el `AccessToken` del propio usuario, NO sobre
 * `AdminSetUserPassword`: no pide `UserPoolId`, `ClientId` ni credenciales de
 * AWS. El token del login de HU-02 lleva el scope
 * `aws.cognito.signin.user.admin` que Cognito exige para esta operacion. El
 * cliente se construye solo con `region`; la autorizacion la lleva el token.
 *
 * Sigue el patron de `CognitoTotpEnrollment`: traduce por TIPO de excepcion del
 * SDK, nunca por el texto del mensaje.
 */
export class CognitoPasswordChange implements PasswordChangePort {
  private readonly client: CognitoIdentityProviderClient

  constructor(options: CognitoPasswordChangeOptions, client?: CognitoIdentityProviderClient) {
    this.client =
      client ??
      new CognitoIdentityProviderClient({
        region: CognitoPasswordChange.regionOf(options.userPoolId),
      })
  }

  async changePassword(
    accessToken: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<PasswordChangeOutcome> {
    try {
      await this.client.send(
        new ChangePasswordCommand({
          AccessToken: accessToken,
          PreviousPassword: currentPassword,
          ProposedPassword: newPassword,
        }),
      )
    } catch (error: unknown) {
      /**
       * `NotAuthorizedException` es la senal de Cognito cuando la contrasena
       * actual no coincide. El testimonio ya lo verifico el guard antes de
       * llegar aqui, asi que este error es de la CREDENCIAL, no de la sesion:
       * 400, no 401. (Ventana residual: un token revocado entre el guard y esta
       * llamada tambien caeria aqui; es una carrera rara y se acepta a
       * proposito, como en `CognitoIdentitySignUp` con `confirmSignUp`.)
       */
      if (error instanceof NotAuthorizedException) {
        return { kind: 'invalidCurrentPassword' }
      }

      /**
       * La politica de contrasena la aplica el pool, no este servicio (igual
       * que en el alta, HU-01). Un rechazo de politica es entrada invalida:
       * 400 con el motivo, no 503.
       */
      if (error instanceof InvalidPasswordException) {
        return {
          kind: 'weakPassword',
          reason: error.message || 'La contrasena nueva no cumple la politica del proveedor.',
        }
      }

      throw new PasswordChangeError(CognitoPasswordChange.describeUnexpected(error))
    }

    return { kind: 'changed' }
  }

  /**
   * Nunca incluye las contrasenas ni el testimonio: van en la peticion, no en la
   * respuesta del SDK. El mensaje se arma con campos conocidos, sin volcar el
   * objeto de error completo.
   */
  private static describeUnexpected(error: unknown): string {
    if (error instanceof LimitExceededException || error instanceof TooManyRequestsException) {
      return 'El proveedor de identidad limito los intentos de cambio de contrasena. Intentelo mas tarde.'
    }

    if (error instanceof Error) {
      return `El proveedor de identidad respondio con un error inesperado: ${error.name}.`
    }

    return 'El proveedor de identidad respondio con un error inesperado.'
  }

  private static regionOf(userPoolId: string): string {
    const region = userPoolId.split('_')[0]

    if (region === undefined || region.length === 0) {
      throw new PasswordChangeError(
        `COGNITO_USER_POOL_ID "${userPoolId}" no tiene el formato esperado "<region>_<id>".`,
      )
    }

    return region
  }
}
