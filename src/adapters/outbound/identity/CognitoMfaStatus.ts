import {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'

import { MfaStatusError, type MfaStatusPort } from '../../../application/ports/MfaStatusPort'

export interface CognitoMfaStatusOptions {
  readonly userPoolId: string
}

/** Lee factores confirmados; `MFAOptions` esta obsoleta y no representa TOTP. */
export class CognitoMfaStatus implements MfaStatusPort {
  private readonly client: CognitoIdentityProviderClient
  private readonly userPoolId: string

  constructor(options: CognitoMfaStatusOptions, client?: CognitoIdentityProviderClient) {
    this.userPoolId = options.userPoolId
    this.client = client ?? new CognitoIdentityProviderClient({})
  }

  async hasConfirmedTotp(subject: string): Promise<boolean> {
    try {
      const response = await this.client.send(
        new AdminGetUserCommand({ UserPoolId: this.userPoolId, Username: subject }),
      )

      return (response.UserMFASettingList ?? []).includes('SOFTWARE_TOKEN_MFA')
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error)

      throw new MfaStatusError(`No se pudo consultar el segundo factor: ${detail}`)
    }
  }
}
