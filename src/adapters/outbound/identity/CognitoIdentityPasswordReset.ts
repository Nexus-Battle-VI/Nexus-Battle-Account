import {
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'

import type {
  IdentityPasswordResetPort,
  PasswordResetOutcome,
} from '../../../application/ports/IdentityPasswordResetPort'

export interface CognitoIdentityPasswordResetOptions {
  readonly userPoolId: string
}

/**
 * Adaptador real de `IdentityPasswordResetPort` sobre Cognito (HU-04, paso 4).
 *
 * Usa `AdminSetUserPassword` con `Permanent: true`: dejar la contrasena en
 * estado temporal forzaria un reto `NEW_PASSWORD_REQUIRED` en el siguiente
 * inicio de sesion, uno que `CognitoAuthenticationProvider` declara
 * explicitamente que HU-02 no sabe resolver. Es una operacion `Admin*`, con
 * las mismas garantias que el resto de adaptadores de este directorio: exige
 * credenciales de AWS firmadas (IAM), no accesibles desde un cliente publico.
 *
 * `Username` es el correo: el pool de este proyecto usa el correo como nombre
 * de usuario (vease `CognitoAuthenticationProvider.authenticate`, que manda
 * `USERNAME: credentials.email`), asi que este adaptador hace lo mismo.
 */
export class CognitoIdentityPasswordReset implements IdentityPasswordResetPort {
  private readonly client: CognitoIdentityProviderClient
  private readonly userPoolId: string

  constructor(
    options: CognitoIdentityPasswordResetOptions,
    client?: CognitoIdentityProviderClient,
  ) {
    this.userPoolId = options.userPoolId
    this.client = client ?? new CognitoIdentityProviderClient({})
  }

  async setPassword(email: string, password: string): Promise<PasswordResetOutcome> {
    try {
      await this.client.send(
        new AdminSetUserPasswordCommand({
          UserPoolId: this.userPoolId,
          Username: email,
          Password: password,
          Permanent: true,
        }),
      )

      return { kind: 'updated' }
    } catch {
      // El motivo nunca se distingue (usuario inexistente, politica de Cognito
      // no satisfecha, error transitorio, etc.): el llamador ya valido su
      // propia politica de contrasena antes de llegar aqui (`PasswordPolicy`),
      // y filtrar el motivo del proveedor podria revelar si la cuenta existe.
      return { kind: 'failed' }
    }
  }
}
