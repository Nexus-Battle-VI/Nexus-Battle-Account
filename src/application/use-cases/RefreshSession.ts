import type { AccountRepositoryPort } from '../ports/AccountRepositoryPort'
import {
  AuthenticationProviderError,
  type AuthenticationProviderPort,
} from '../ports/AuthenticationProviderPort'
import { TokenVerificationError, type TokenVerifierPort } from '../ports/TokenVerifierPort'
import { toAccountDto } from '../dto/AccountDto'
import type { RefreshSessionOutcome } from '../dto/LoginResult'

export interface RefreshSessionDependencies {
  readonly accounts: AccountRepositoryPort
  readonly authenticationProvider: AuthenticationProviderPort
  readonly tokenVerifier: TokenVerifierPort
}

/**
 * Renueva una sesion sin credenciales, a partir del testimonio de refresco
 * que `SessionsController` guarda en una cookie `HttpOnly` (HU-02, sesion
 * persistente tras recargar la pagina).
 *
 * VERIFICA EL ACCESS TOKEN RECIEN EMITIDO, igual que `CompleteSecondFactor`
 * hace con el suyo: `refresh` del proveedor solo demuestra que el testimonio
 * de refresco era valido, no que la cuenta pueda seguir autenticando HOY. Una
 * cuenta suspendida o eliminada DESPUES de emitir ese refresco no debe poder
 * seguir renovando sesiones con el.
 *
 * NO REPITE la logica de reincorporacion de `LoginAccount` (suspension
 * temporal ya vencida): si la cuenta sigue suspendida, renovar simplemente
 * falla con `invalid` y la persona vuelve a iniciar sesion por credenciales,
 * que es donde esa reincorporacion vive.
 */
export class RefreshSession {
  constructor(private readonly deps: RefreshSessionDependencies) {}

  async execute(refreshToken: string): Promise<RefreshSessionOutcome> {
    let outcome: Awaited<ReturnType<AuthenticationProviderPort['refresh']>>

    try {
      outcome = await this.deps.authenticationProvider.refresh(refreshToken)
    } catch (error: unknown) {
      if (error instanceof AuthenticationProviderError) {
        return { kind: 'providerUnavailable' }
      }

      throw error
    }

    if (outcome.kind === 'invalid') {
      return { kind: 'invalid' }
    }

    let identity
    try {
      identity = await this.deps.tokenVerifier.verify(outcome.accessToken)
    } catch (error: unknown) {
      if (error instanceof TokenVerificationError) {
        return { kind: 'invalid' }
      }

      throw error
    }

    const account = await this.deps.accounts.findBySubject(identity.subject)

    if (!account?.canAuthenticate) {
      return { kind: 'invalid' }
    }

    return {
      kind: 'refreshed',
      account: toAccountDto(account.toSnapshot()),
      subject: account.subject,
      accessToken: outcome.accessToken,
      expiresIn: outcome.expiresIn,
    }
  }
}
