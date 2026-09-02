import type { MfaEvidence } from '../../domain/entities/MfaEvidence'
import type { SecondFactorMethod } from '../../domain/entities/SecondFactorMethod'

/**
 * Puerto de persistencia de la evidencia de segundo factor.
 *
 * `save` debe ser DURABLE antes de que el caso de uso entregue el testimonio:
 * si la escritura falla, no se entrega. Devolver primero el token y persistir
 * despues dejaria testimonios administrativos sin evidencia, indistinguibles de
 * los que nunca superaron el segundo factor.
 *
 * `isValidFor` responde la unica pregunta que necesita el contrato interno, y
 * la responde entera: exige coincidencia de sujeto, identificador de testimonio
 * Y metodo, y que la evidencia siga vigente. Omitir el metodo permitiria aceptar
 * SMS o correo donde el consumidor exige aplicacion autenticadora. No se expone
 * un `find`: quien pregunta no necesita el contenido, solo si vale.
 */
export interface MfaEvidenceRepositoryPort {
  save(evidence: MfaEvidence): Promise<void>

  isValidFor(subject: string, jti: string, method: SecondFactorMethod, now: Date): Promise<boolean>
}

export const MFA_EVIDENCE_REPOSITORY = Symbol('MfaEvidenceRepositoryPort')
