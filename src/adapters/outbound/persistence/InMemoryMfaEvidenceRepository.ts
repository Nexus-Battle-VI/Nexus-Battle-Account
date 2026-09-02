import type { MfaEvidence } from '../../../domain/entities/MfaEvidence'
import type { SecondFactorMethod } from '../../../domain/entities/SecondFactorMethod'
import type { MfaEvidenceRepositoryPort } from '../../../application/ports/MfaEvidenceRepositoryPort'

/**
 * Evidencia de segundo factor en memoria, para desarrollo local y pruebas.
 *
 * No es una prueba falsa: implementa la misma semantica que el adaptador de
 * PostgreSQL, incluida la caducidad, de modo que una prueba que pase aqui
 * describe el mismo comportamiento que el sistema desplegado.
 */
export class InMemoryMfaEvidenceRepository implements MfaEvidenceRepositoryPort {
  private readonly evidences = new Map<string, MfaEvidence>()

  private static keyOf(subject: string, jti: string): string {
    // El separador no puede aparecer en un `sub` ni en un `jti` de Cognito
    // -ambos son UUID-, asi que dos claves distintas no pueden colisionar.
    return `${subject}\u0000${jti}`
  }

  save(evidence: MfaEvidence): Promise<void> {
    this.evidences.set(
      InMemoryMfaEvidenceRepository.keyOf(evidence.subject, evidence.jti),
      evidence,
    )

    return Promise.resolve()
  }

  isValidFor(
    subject: string,
    jti: string,
    method: SecondFactorMethod,
    now: Date,
  ): Promise<boolean> {
    const evidence = this.evidences.get(InMemoryMfaEvidenceRepository.keyOf(subject, jti))

    return Promise.resolve(evidence?.method === method && evidence.isValidAt(now))
  }
}
