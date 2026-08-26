import type {
  AuthenticationCredentials,
  AuthenticationOutcome,
  AuthenticationProviderPort,
  SecondFactorOutcome,
  SecondFactorVerification,
} from '../../../application/ports/AuthenticationProviderPort'

export interface SeededCredential {
  readonly email: string
  readonly password: string
  /** Si es true, `authenticate` siempre exige segundo factor para este correo. */
  readonly requiresSecondFactor?: boolean
  /** Codigo esperado en `verifySecondFactor`. Ignorado si no exige segundo factor. */
  readonly secondFactorCode?: string
}

interface StoredCredential {
  readonly password: string
  readonly requiresSecondFactor: boolean
  readonly secondFactorCode: string
}

interface PendingChallenge {
  readonly email: string
  readonly code: string
}

/**
 * Proveedor de autenticacion para desarrollo y pruebas (HU-02).
 *
 * Igual que `FakeIdentityProvider`: no es una simulacion de comportamiento,
 * es una implementacion real y completa de `AuthenticationProviderPort` sobre
 * almacenamiento en memoria. Se siembra explicitamente con `seed(...)`: no
 * reutiliza lo que `IdentityProviderPort.register` recibe, porque ese puerto
 * declara -deliberadamente- que NO conserva la contrasena. Un proveedor real
 * (Cognito) es quien custodia ambas cosas a la vez; aqui se modelan como dos
 * fakes angostos y sin estado compartido, tal como los dos puertos que
 * implementan.
 */
export class FakeAuthenticationProvider implements AuthenticationProviderPort {
  private readonly credentials = new Map<string, StoredCredential>()
  private readonly pendingChallenges = new Map<string, PendingChallenge>()
  private readonly nextToken: () => string

  constructor(nextToken: () => string) {
    this.nextToken = nextToken
  }

  seed(credential: SeededCredential): void {
    this.credentials.set(credential.email.trim().toLowerCase(), {
      password: credential.password,
      requiresSecondFactor: credential.requiresSecondFactor ?? false,
      secondFactorCode: credential.secondFactorCode ?? '000000',
    })
  }

  authenticate(credentials: AuthenticationCredentials): Promise<AuthenticationOutcome> {
    const normalized = credentials.email.trim().toLowerCase()
    const stored = this.credentials.get(normalized)

    if (stored?.password !== credentials.password) {
      return Promise.resolve({ kind: 'invalidCredentials' })
    }

    if (stored.requiresSecondFactor) {
      const challengeToken = `challenge-${this.nextToken()}`
      this.pendingChallenges.set(challengeToken, {
        email: normalized,
        code: stored.secondFactorCode,
      })

      return Promise.resolve({ kind: 'challengeRequired', challengeToken })
    }

    return Promise.resolve({ kind: 'authenticated', accessToken: this.issueAccessToken() })
  }

  verifySecondFactor(input: SecondFactorVerification): Promise<SecondFactorOutcome> {
    const normalized = input.email.trim().toLowerCase()
    const pending = this.pendingChallenges.get(input.challengeToken)

    if (pending?.email !== normalized) {
      return Promise.resolve({ kind: 'challengeExpired' })
    }

    if (pending.code !== input.code) {
      return Promise.resolve({ kind: 'invalidCode' })
    }

    this.pendingChallenges.delete(input.challengeToken)

    return Promise.resolve({ kind: 'verified', accessToken: this.issueAccessToken() })
  }

  private issueAccessToken(): string {
    return `fake-access-token-${this.nextToken()}`
  }
}
