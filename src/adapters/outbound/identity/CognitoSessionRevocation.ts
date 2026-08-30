import {
  AdminUserGlobalSignOutCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'

import {
  SessionRevocationError,
  type SessionRevocationPort,
} from '../../../application/ports/SessionRevocationPort'

export interface CognitoSessionRevocationOptions {
  readonly userPoolId: string
}

/** Corta las sesiones renovables del sujeto tras retirar un rol elevado. */
export class CognitoSessionRevocation implements SessionRevocationPort {
  private readonly client: CognitoIdentityProviderClient
  private readonly userPoolId: string

  constructor(options: CognitoSessionRevocationOptions, client?: CognitoIdentityProviderClient) {
    this.userPoolId = options.userPoolId
    this.client = client ?? new CognitoIdentityProviderClient({})
  }

  async globalSignOut(subject: string): Promise<void> {
    try {
      await this.client.send(
        new AdminUserGlobalSignOutCommand({ UserPoolId: this.userPoolId, Username: subject }),
      )
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error)

      throw new SessionRevocationError(`No se pudo cerrar la sesion global: ${detail}`)
    }
  }
}
