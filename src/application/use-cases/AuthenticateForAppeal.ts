import type { AccountRepositoryPort } from '../ports/AccountRepositoryPort'
import {
  AuthenticationProviderError,
  type AuthenticationProviderPort,
} from '../ports/AuthenticationProviderPort'
import type { AppealAccessTokenPort } from '../ports/AppealAccessTokenPort'
import { resolveAccountByIdentifier } from './AccountIdentifierResolver'

export interface AuthenticateForAppealCommand {
  readonly identifier: string
  readonly password: string
}

const APPEAL_TOKEN_TTL_SECONDS = 30 * 60

export type AuthenticateForAppealOutcome =
  | {
      readonly kind: 'appealAuthenticated'
      readonly appealToken: string
      readonly expiresIn: number
    }
  | { readonly kind: 'invalidCredentials' }
  | { readonly kind: 'providerUnavailable' }
  /**
   * El proveedor reto con segundo factor. Este flujo de alcance restringido
   * (HU-42, §6) no implementa esa segunda etapa: una cuenta con segundo
   * factor inscrito (hoy, solo roles administrativos) debe apelar desde el
   * inicio de sesion normal mientras su testimonio siga vigente. Declarar la
   * limitacion es preferible a fingir un flujo de codigo que no se procesa.
   */
  | { readonly kind: 'secondFactorNotSupportedForAppeal' }

/**
 * Primera etapa, y unica, de la "identidad restringida" para apelar (HU-42,
 * §6): demuestra la misma contrasena que `LoginAccount`, pero a diferencia de
 * ese caso de uso NUNCA consulta `canAuthenticate` ni el estado de la cuenta:
 * una cuenta suspendida o baneada es exactamente a quien este flujo debe
 * dejar pasar. Lo que impide que esto reabra acceso general es que el
 * resultado NO es el testimonio de Cognito -ver `AppealAccessTokenPort`-, asi
 * que ningun otro endpoint de este ni de otro servicio lo acepta.
 */
export class AuthenticateForAppeal {
  constructor(
    private readonly accounts: AccountRepositoryPort,
    private readonly authenticationProvider: AuthenticationProviderPort,
    private readonly appealAccessToken: AppealAccessTokenPort,
  ) {}

  async execute(command: AuthenticateForAppealCommand): Promise<AuthenticateForAppealOutcome> {
    const account = await resolveAccountByIdentifier(this.accounts, command.identifier)

    if (account === null) {
      return { kind: 'invalidCredentials' }
    }

    let outcome: Awaited<ReturnType<AuthenticationProviderPort['authenticate']>>

    try {
      outcome = await this.authenticationProvider.authenticate({
        email: account.currentEmail.value,
        password: command.password,
      })
    } catch (error: unknown) {
      if (error instanceof AuthenticationProviderError) {
        return { kind: 'providerUnavailable' }
      }

      throw error
    }

    if (outcome.kind === 'invalidCredentials') {
      return { kind: 'invalidCredentials' }
    }

    if (outcome.kind === 'challengeRequired' || outcome.kind === 'selectionRequired') {
      return { kind: 'secondFactorNotSupportedForAppeal' }
    }

    const appealToken = this.appealAccessToken.issue(
      { accountId: account.id.value, subject: account.subject },
      APPEAL_TOKEN_TTL_SECONDS,
    )

    return { kind: 'appealAuthenticated', appealToken, expiresIn: APPEAL_TOKEN_TTL_SECONDS }
  }
}
