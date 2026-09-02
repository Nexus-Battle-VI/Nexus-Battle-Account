import type { Kysely } from 'kysely'

import type { MfaEvidence } from '../../../domain/entities/MfaEvidence'
import type { SecondFactorMethod } from '../../../domain/entities/SecondFactorMethod'
import type { MfaEvidenceRepositoryPort } from '../../../application/ports/MfaEvidenceRepositoryPort'
import type { Database } from './schema'

/**
 * Evidencia de segundo factor en PostgreSQL.
 *
 * La clave primaria compuesta es `(subject, jti)`. El `onConflict` que
 * reescribe la fila cubre el reintento honesto —la misma persona repite el
 * segundo factor y Cognito devuelve el mismo testimonio— sin dejar duplicados.
 */
export class PostgresMfaEvidenceRepository implements MfaEvidenceRepositoryPort {
  private readonly db: Kysely<Database>

  constructor(db: Kysely<Database>) {
    this.db = db
  }

  async save(evidence: MfaEvidence): Promise<void> {
    const snapshot = evidence.toSnapshot()

    await this.db
      .insertInto('mfa_evidences')
      .values({
        subject: snapshot.subject,
        jti: snapshot.jti,
        method: snapshot.method,
        expires_at: snapshot.expiresAt,
        verified_at: snapshot.verifiedAt,
      })
      .onConflict((oc) =>
        oc.columns(['subject', 'jti']).doUpdateSet({
          method: snapshot.method,
          expires_at: snapshot.expiresAt,
          verified_at: snapshot.verifiedAt,
        }),
      )
      .execute()
  }

  /**
   * La vigencia se filtra EN LA CONSULTA, no despues de leer la fila.
   *
   * Asi una evidencia caducada es indistinguible de una inexistente para quien
   * pregunta, y de paso no hace falta un proceso que borre filas vencidas: una
   * fila caducada deja de responder que si en el mismo instante en que expira.
   */
  async isValidFor(
    subject: string,
    jti: string,
    method: SecondFactorMethod,
    now: Date,
  ): Promise<boolean> {
    const row = await this.db
      .selectFrom('mfa_evidences')
      .select('subject')
      .where('subject', '=', subject)
      .where('jti', '=', jti)
      .where('method', '=', method)
      .where('expires_at', '>', now)
      .executeTakeFirst()

    return row !== undefined
  }
}
