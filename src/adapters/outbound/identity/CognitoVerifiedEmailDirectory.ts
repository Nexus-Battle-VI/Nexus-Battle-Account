import {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
  type AttributeType,
} from '@aws-sdk/client-cognito-identity-provider'

import {
  VerifiedEmailDirectoryError,
  type VerifiedEmailDirectoryPort,
} from '../../../application/ports/VerifiedEmailDirectoryPort'

export interface CognitoVerifiedEmailDirectoryOptions {
  readonly userPoolId: string
}

/**
 * Consulta en Cognito los atributos reales del sujeto mediante `AdminGetUser`.
 *
 * El access token sigue siendo el testimonio correcto para autorizar y llevar
 * `cognito:groups`; no se intenta obtener de el un correo que no contiene.
 * `AdminGetUser` usa las credenciales IAM de la cadena por defecto, igual que
 * el directorio de roles, y nunca recibe claves de acceso explicitas.
 */
export class CognitoVerifiedEmailDirectory implements VerifiedEmailDirectoryPort {
  private readonly client: CognitoIdentityProviderClient
  private readonly userPoolId: string

  constructor(
    options: CognitoVerifiedEmailDirectoryOptions,
    client?: CognitoIdentityProviderClient,
  ) {
    this.userPoolId = options.userPoolId
    this.client = client ?? new CognitoIdentityProviderClient({})
  }

  async findVerifiedEmail(subject: string): Promise<string | null> {
    try {
      const response = await this.client.send(
        new AdminGetUserCommand({
          UserPoolId: this.userPoolId,
          Username: subject,
        }),
      )

      const attributes = response.UserAttributes ?? []

      if (this.attributeValue(attributes, 'email_verified') !== 'true') {
        return null
      }

      const email = this.attributeValue(attributes, 'email')

      return email !== null && email.trim().length > 0 ? email : null
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error)

      throw new VerifiedEmailDirectoryError(
        `No se pudo consultar el correo verificado en el proveedor: ${detail}`,
      )
    }
  }

  private attributeValue(attributes: readonly AttributeType[], name: string): string | null {
    const value = attributes.find((attribute) => attribute.Name === name)?.Value

    return typeof value === 'string' ? value : null
  }
}
