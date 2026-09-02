import type { ClockPort } from '../ports/ClockPort'
import type { MfaEvidenceRepositoryPort } from '../ports/MfaEvidenceRepositoryPort'
import {
  isSecondFactorMethod,
  type SecondFactorMethod,
} from '../../domain/entities/SecondFactorMethod'

export interface VerifyMfaEvidenceQuery {
  readonly subject: string
  readonly jti: string
  readonly method: SecondFactorMethod
}

export interface VerifyMfaEvidenceDependencies {
  readonly mfaEvidence: MfaEvidenceRepositoryPort
  readonly clock: ClockPort
}

/**
 * Responde si un testimonio concreto nacio de un segundo factor.
 *
 * DEVUELVE UN BOOLEANO Y NADA MAS. Quien pregunta es otro servicio que solo
 * necesita decidir si continua; devolverle cuando se verifico, cuando expira o
 * a que cuenta pertenece seria filtrar informacion de autenticacion fuera del
 * contexto que la posee, sin que nadie la necesite.
 *
 * EXIGE SUJETO, JTI Y METODO. Comprobar solo el sujeto convertiria la evidencia
 * de un testimonio en un permiso permanente de la persona: cualquier token
 * posterior, nacido sin segundo factor, pasaria la comprobacion. Omitir el
 * metodo confundiria TOTP con SMS o correo.
 */
export class VerifyMfaEvidence {
  private readonly deps: VerifyMfaEvidenceDependencies

  constructor(deps: VerifyMfaEvidenceDependencies) {
    this.deps = deps
  }

  async execute(query: VerifyMfaEvidenceQuery): Promise<boolean> {
    // Defensivo aunque el pipe de validacion ya rechace lo malformado: este
    // caso de uso decide una autorizacion, y un 500 por un campo ausente seria
    // un fallo mas ruidoso que util. Ante una consulta incompleta, la respuesta
    // honesta es que no hay evidencia.
    if (
      typeof query.subject !== 'string' ||
      typeof query.jti !== 'string' ||
      !isSecondFactorMethod(query.method)
    ) {
      return false
    }

    if (query.subject.length === 0 || query.jti.length === 0) {
      return false
    }

    return await this.deps.mfaEvidence.isValidFor(
      query.subject,
      query.jti,
      query.method,
      this.deps.clock.now(),
    )
  }
}
