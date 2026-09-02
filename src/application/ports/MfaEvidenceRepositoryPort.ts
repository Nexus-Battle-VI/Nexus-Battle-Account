import type { MfaEvidence } from '../../domain/entities/MfaEvidence'

/**
 * Puerto de persistencia de la evidencia de segundo factor.
 *
 * `save` debe ser DURABLE antes de que el caso de uso entregue el testimonio:
 * si la escritura falla, no se entrega. Devolver primero el token y persistir
 * despues dejaria testimonios administrativos sin evidencia, indistinguibles de
 * los que nunca superaron el segundo factor.
 *
 * `isValidFor` responde la unica pregunta que necesita el contrato interno, y
 * la responde entera: exige coincidencia de sujeto Y de identificador de
 * testimonio, y que la evidencia siga vigente. No se expone un `find` que
 * devuelva la evidencia: quien pregunta no necesita su contenido, solo si vale.
 */
export interface MfaEvidenceRepositoryPort {
  save(evidence: MfaEvidence): Promise<void>

  isValidFor(subject: string, jti: string, now: Date): Promise<boolean>
}

export const MFA_EVIDENCE_REPOSITORY = Symbol('MfaEvidenceRepositoryPort')
