import type { AccountRepositoryPort } from '../ports/AccountRepositoryPort'
import {
  AuthenticationProviderError,
  type AuthenticationProviderPort,
} from '../ports/AuthenticationProviderPort'
import { toAccountDto } from '../dto/AccountDto'
import type { LoginOutcome } from '../dto/LoginResult'
import { resolveAccountByIdentifier } from './AccountIdentifierResolver'

export interface CompleteSecondFactorCommand {
  /** El mismo identificador (correo o apodo) que la primera etapa. */
  readonly identifier: string
  readonly challengeToken: string
  readonly code: string
}

export interface CompleteSecondFactorDependencies {
  readonly accounts: AccountRepositoryPort
  readonly authenticationProvider: AuthenticationProviderPort
}

/**
 * Segunda etapa del inicio de sesion administrativo (HU-02, CA-07 / CA-08).
 *
 * Recibe de nuevo el identificador -no un correo resuelto por el cliente- por
 * la misma razon que `LoginAccount`: Web no debe tener que saber ni convertir
 * un apodo a un correo. Este caso de uso repite la misma resolucion, sin
 * estado propio: toda la continuidad del reto vive en `challengeToken`, que
 * es opaco y lo emite el proveedor.
 */
export class CompleteSecondFactor {
  private readonly deps: CompleteSecondFactorDependencies

  constructor(deps: CompleteSecondFactorDependencies) {
    this.deps = deps
  }

  async execute(command: CompleteSecondFactorCommand): Promise<LoginOutcome> {
    const account = await resolveAccountByIdentifier(this.deps.accounts, command.identifier)

    if (!account?.canAuthenticate) {
      return { kind: 'invalidCredentials' }
    }

    let outcome: Awaited<ReturnType<AuthenticationProviderPort['verifySecondFactor']>>

    try {
      outcome = await this.deps.authenticationProvider.verifySecondFactor({
        email: account.currentEmail.value,
        challengeToken: command.challengeToken,
        code: command.code,
      })
    } catch (error: unknown) {
      if (error instanceof AuthenticationProviderError) {
        return { kind: 'providerUnavailable' }
      }

      throw error
    }

    if (outcome.kind === 'invalidCode' || outcome.kind === 'challengeExpired') {
      return { kind: 'secondFactorInvalid' }
    }

    return {
      kind: 'authenticated',
      account: toAccountDto(account.toSnapshot()),
      subject: account.subject,
      accessToken: outcome.accessToken,
      expiresIn: outcome.expiresIn,
    }
  }
}
