import { MfaEvidence } from '../../domain/entities/MfaEvidence'
import type { SecondFactorMethod } from '../../domain/entities/SecondFactorMethod'
import type { AccountRepositoryPort } from '../ports/AccountRepositoryPort'
import {
  AuthenticationProviderError,
  type AuthenticationProviderPort,
} from '../ports/AuthenticationProviderPort'
import type { ClockPort } from '../ports/ClockPort'
import type { MfaEvidenceRepositoryPort } from '../ports/MfaEvidenceRepositoryPort'
import { TokenVerificationError, type TokenVerifierPort } from '../ports/TokenVerifierPort'
import { toAccountDto } from '../dto/AccountDto'
import type { LoginOutcome } from '../dto/LoginResult'
import { resolveAccountByIdentifier } from './AccountIdentifierResolver'

export interface CompleteSecondFactorCommand {
  /** El mismo identificador (correo o apodo) que la primera etapa. */
  readonly identifier: string
  readonly challengeToken: string
  readonly code: string
}

export interface CompleteSecondFactorLog {
  warn(message: string, context?: Readonly<Record<string, string | number | boolean | null>>): void
}

export interface CompleteSecondFactorDependencies {
  readonly accounts: AccountRepositoryPort
  readonly authenticationProvider: AuthenticationProviderPort
  readonly tokenVerifier: TokenVerifierPort
  readonly mfaEvidence: MfaEvidenceRepositoryPort
  readonly clock: ClockPort
  readonly logger: CompleteSecondFactorLog
}

/**
 * Segunda etapa del inicio de sesion administrativo (HU-02, CA-07 / CA-08).
 *
 * Recibe de nuevo el identificador -no un correo resuelto por el cliente- por
 * la misma razon que `LoginAccount`: Web no debe tener que saber ni convertir
 * un apodo a un correo. Este caso de uso repite la misma resolucion, sin
 * estado propio de reto: toda la continuidad vive en `challengeToken`, que es
 * opaco y lo emite el proveedor.
 *
 * DEJA CONSTANCIA DE QUE EL SEGUNDO FACTOR OCURRIO. Antes devolvia el
 * testimonio y nada mas, de modo que ningun servicio podia distinguir despues
 * un token nacido tras el segundo factor de otro nacido sin el; ante esa duda,
 * el rol administrativo bastaba por si solo. Ahora Account verifica el
 * testimonio que acaba de recibir, extrae de el `sub`, `jti` y `exp`, y guarda
 * esa evidencia ANTES de entregarlo.
 *
 * EL ORDEN IMPORTA Y ES DELIBERADO. Entregar primero y persistir despues
 * dejaria testimonios administrativos sin evidencia, indistinguibles de los que
 * nunca superaron el segundo factor. Si la escritura falla, no se entrega nada:
 * la sesion se pierde y la persona reintenta, que es preferible a una sesion
 * administrativa que el resto del sistema no puede verificar.
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

    const recorded = await this.recordEvidence(outcome.accessToken, account.subject, outcome.method)

    if (!recorded) {
      return { kind: 'providerUnavailable' }
    }

    return {
      kind: 'authenticated',
      account: toAccountDto(account.toSnapshot()),
      subject: account.subject,
      accessToken: outcome.accessToken,
      expiresIn: outcome.expiresIn,
    }
  }

  /**
   * Verifica el testimonio recien emitido y deja constancia del segundo factor.
   *
   * SE VERIFICA EL TOKEN AUNQUE VENGA DEL PROVEEDOR. No es desconfianza del
   * proveedor: es que `jti` y `exp` van a gobernar una decision de autorizacion
   * en otros servicios, y deben salir de un testimonio comprobado
   * criptograficamente, no de una respuesta que este proceso da por buena.
   *
   * SE COMPRUEBA QUE EL SUJETO COINCIDE con la cuenta que se acaba de
   * autenticar. Sin esa comprobacion, un desajuste entre el proveedor y la
   * cuenta —el mismo que ADR-004 documenta como posible— registraria la
   * evidencia a nombre de otro sujeto.
   *
   * Devuelve `false` en lugar de lanzar: el llamador traduce ese caso a
   * `providerUnavailable`, que es lo que es —no se pudo completar el inicio de
   * sesion de forma seria— y no un codigo invalido, que culparia a la persona.
   */
  private async recordEvidence(
    accessToken: string,
    expectedSubject: string,
    method: SecondFactorMethod,
  ): Promise<boolean> {
    let identity

    try {
      identity = await this.deps.tokenVerifier.verify(accessToken)
    } catch (error: unknown) {
      this.deps.logger.warn('mfa_evidence_token_no_verificable', {
        reason: error instanceof TokenVerificationError ? 'verificacion' : 'desconocido',
      })

      return false
    }

    if (identity.subject !== expectedSubject) {
      this.deps.logger.warn('mfa_evidence_sujeto_discrepante', {})

      return false
    }

    if (identity.jti === null || identity.expiresAt === null) {
      // Sin `jti` la evidencia no podria ligarse a este testimonio, y sin `exp`
      // no tendria vigencia propia. Guardar algo inventado seria peor que no
      // guardar nada: aparentaria una prueba que no describe ningun token.
      this.deps.logger.warn('mfa_evidence_token_sin_identificador', {})

      return false
    }

    try {
      await this.deps.mfaEvidence.save(
        MfaEvidence.create({
          subject: identity.subject,
          jti: identity.jti,
          method,
          expiresAt: identity.expiresAt,
          verifiedAt: this.deps.clock.now(),
        }),
      )
    } catch (error: unknown) {
      this.deps.logger.warn('mfa_evidence_no_persistida', {
        reason: error instanceof Error ? error.name : 'desconocido',
      })

      return false
    }

    return true
  }
}
