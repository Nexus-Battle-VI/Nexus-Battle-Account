import {
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'

import type {
  IdentityPasswordResetPort,
  PasswordResetOutcome,
} from '../../../application/ports/IdentityPasswordResetPort'
import type { Logger } from '../../../infrastructure/observability/logger'

export interface CognitoIdentityPasswordResetOptions {
  readonly userPoolId: string
  /**
   * Opcional para no romper a quien construya el adaptador en una prueba, pero
   * en produccion SIEMPRE se inyecta: sin el, un fallo aqui es invisible.
   */
  readonly logger?: Logger
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
  private readonly logger: Logger | null

  constructor(
    options: CognitoIdentityPasswordResetOptions,
    client?: CognitoIdentityProviderClient,
  ) {
    this.userPoolId = options.userPoolId
    this.logger = options.logger ?? null
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
    } catch (error: unknown) {
      // EL RESULTADO sigue siendo opaco: quien llama recibe `failed` y nada mas.
      // El motivo (usuario inexistente, politica de Cognito no satisfecha, error
      // transitorio) no debe viajar en la respuesta, porque revelaria si la
      // cuenta existe.
      //
      // PERO SI SE REGISTRA. Antes se descartaba con un `catch` a secas, y eso
      // convertia cualquier fallo en un 503 mudo. Ocurrio de verdad el
      // 2026-09-02: faltaba el permiso `cognito-idp:AdminSetUserPassword` en el
      // rol del nodo y el log de Account no decia absolutamente nada, asi que
      // hubo que deducirlo simulando la politica de IAM. Opaco hacia fuera no
      // significa opaco hacia dentro.
      //
      // Se registra el NOMBRE del error, no el mensaje ni el correo: basta para
      // distinguir `AccessDeniedException` de `InvalidPasswordException` o
      // `UserNotFoundException`, que es lo que se necesita para diagnosticar.
      this.logger?.error('identity_password_reset_failed', {
        reason: error instanceof Error ? error.name : 'desconocido',
      })

      return { kind: 'failed' }
    }
  }
}
