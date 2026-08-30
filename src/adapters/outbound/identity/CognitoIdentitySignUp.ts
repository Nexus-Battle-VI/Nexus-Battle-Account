import {
  CognitoIdentityProviderClient,
  ConfirmSignUpCommand,
  SignUpCommand,
  CodeMismatchException,
  ExpiredCodeException,
  NotAuthorizedException,
  UsernameExistsException,
  InvalidPasswordException,
  type SignUpCommandOutput,
} from '@aws-sdk/client-cognito-identity-provider'

import {
  IdentitySignUpError,
  type ConfirmSignUpOutcome,
  type IdentitySignUpPort,
  type SignUpOutcome,
} from '../../../application/ports/IdentitySignUpPort'

export interface CognitoIdentitySignUpOptions {
  readonly userPoolId: string
  readonly clientId: string
}

/**
 * Alta de identidad sobre el flujo PUBLICO de Cognito (`SignUp`/`ConfirmSignUp`),
 * no sobre `AdminCreateUser`.
 *
 * La eleccion no es cosmetica. `SignUp` deja la identidad en estado no
 * confirmado y hace que Cognito **envie un codigo al correo con su emisor por
 * defecto** -el mismo que ya entrega los codigos hoy, sin SES-, de modo que la
 * verificacion del buzon sigue siendo real. `AdminCreateUser` no verifica el
 * correo por si solo y llevaria a autoproclamarlo, que es lo contrario de lo
 * que este alta debe garantizar.
 *
 * Son APIs publicas: se invocan con el `client_id` y NO requieren credenciales
 * de AWS ni permiso IAM. El cliente del pool es publico y no tiene secreto, asi
 * que no se calcula `SecretHash`.
 */
export class CognitoIdentitySignUp implements IdentitySignUpPort {
  private readonly client: CognitoIdentityProviderClient
  private readonly clientId: string

  constructor(options: CognitoIdentitySignUpOptions) {
    this.clientId = options.clientId
    this.client = new CognitoIdentityProviderClient({
      region: CognitoIdentitySignUp.regionOf(options.userPoolId),
    })
  }

  async signUp(email: string, password: string): Promise<SignUpOutcome> {
    let response: SignUpCommandOutput

    try {
      response = await this.client.send(
        new SignUpCommand({
          ClientId: this.clientId,
          Username: email,
          Password: password,
          UserAttributes: [{ Name: 'email', Value: email }],
        }),
      )
    } catch (error: unknown) {
      if (error instanceof UsernameExistsException) {
        return { kind: 'emailTaken' }
      }

      /**
       * La politica de contrasena la aplica Cognito, no Account. Un rechazo de
       * politica NO es un fallo del proveedor: es una entrada invalida, y quien
       * llama merece un 400 con el motivo, no un 503. Se envuelve para que la
       * capa de aplicacion la distinga.
       */
      if (error instanceof InvalidPasswordException) {
        throw new IdentitySignUpError(
          error.message || 'La contrasena no cumple la politica del proveedor.',
        )
      }

      throw new IdentitySignUpError(
        error instanceof Error ? error.message : 'El proveedor rechazo el alta.',
      )
    }

    if (response.UserSub === undefined || response.UserSub.length === 0) {
      throw new IdentitySignUpError('El proveedor no devolvio el sujeto de la identidad creada.')
    }

    return { kind: 'created', subject: response.UserSub }
  }

  async confirmSignUp(email: string, code: string): Promise<ConfirmSignUpOutcome> {
    try {
      await this.client.send(
        new ConfirmSignUpCommand({
          ClientId: this.clientId,
          Username: email,
          ConfirmationCode: code,
        }),
      )
    } catch (error: unknown) {
      if (error instanceof CodeMismatchException) {
        return { kind: 'invalidCode' }
      }

      if (error instanceof ExpiredCodeException) {
        return { kind: 'expired' }
      }

      /**
       * `ConfirmSignUp` sobre una identidad YA confirmada responde
       * `NotAuthorizedException` ("User cannot be confirmed. Current status is
       * CONFIRMED"). No es un error del que registra: no hay nada que hacer.
       */
      if (error instanceof NotAuthorizedException) {
        return { kind: 'alreadyConfirmed' }
      }

      throw new IdentitySignUpError(
        error instanceof Error ? error.message : 'El proveedor rechazo la confirmacion.',
      )
    }

    return { kind: 'confirmed' }
  }

  private static regionOf(userPoolId: string): string {
    const region = userPoolId.split('_')[0]

    if (region === undefined || region.length === 0) {
      throw new IdentitySignUpError(
        `COGNITO_USER_POOL_ID "${userPoolId}" no tiene el formato esperado "<region>_<id>".`,
      )
    }

    return region
  }
}
