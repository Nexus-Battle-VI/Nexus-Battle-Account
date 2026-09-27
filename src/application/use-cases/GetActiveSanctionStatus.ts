import type { AccountRepositoryPort } from '../ports/AccountRepositoryPort'
import type { SanctionRepositoryPort } from '../ports/SanctionRepositoryPort'
import type { ClockPort } from '../ports/ClockPort'
import { AccountNotFoundError } from '../errors/ApplicationError'
import { AccountStatus } from '../../domain/entities/AccountStatus'

/**
 * Responde si una cuenta esta actualmente impedida de operar por una sancion
 * (HU-42), para que otro servicio decida sin duplicar el modelo de sanciones.
 *
 * Replica la MISMA semantica que `LoginAccount`: bloqueada siempre por
 * PERMANENT_BAN; bloqueada por TEMPORARY_SUSPENSION solo mientras no haya
 * vencido. A diferencia de `LoginAccount`, es una consulta pura: no
 * reincorpora la cuenta cuando la suspension ya vencio -esa reincorporacion es
 * un efecto de iniciar sesion, no de que otro servicio pregunte.
 */
export class GetActiveSanctionStatus {
  constructor(
    private readonly accounts: AccountRepositoryPort,
    private readonly sanctions: SanctionRepositoryPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(subject: string): Promise<boolean> {
    const account = await this.accounts.findBySubject(subject)

    if (account === null) {
      throw new AccountNotFoundError(
        subject,
        'El testimonio no tiene ninguna cuenta asociada en este servicio.',
      )
    }

    if (account.currentStatus === AccountStatus.Banned) {
      return true
    }

    if (account.currentStatus === AccountStatus.Suspended) {
      const activeSuspension = await this.sanctions.findActiveTemporarySuspension(
        account.id.value,
        this.clock.now(),
      )

      return activeSuspension !== null
    }

    return false
  }
}
