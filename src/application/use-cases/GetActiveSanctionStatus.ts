import type { AccountRepositoryPort } from '../ports/AccountRepositoryPort'
import type { SanctionRepositoryPort } from '../ports/SanctionRepositoryPort'
import type { ClockPort } from '../ports/ClockPort'
import { AccountNotFoundError } from '../errors/ApplicationError'
import { AccountStatus } from '../../domain/entities/AccountStatus'
import type { Sanction } from '../../domain/entities/Sanction'
import { SanctionType } from '../../domain/entities/SanctionType'

export interface ActiveSanctionStatus {
  readonly hasActiveSanctions: boolean
  readonly sanctions: readonly Sanction[]
}

/**
 * Responde qué sanciones impiden actualmente operar a una cuenta (HU-42),
 * para que otro servicio decida sin duplicar el modelo de sanciones.
 *
 * Replica la MISMA semantica que `LoginAccount`: bloqueada siempre por
 * PERMANENT_BAN; bloqueada por TEMPORARY_SUSPENSION solo mientras no haya
 * vencido. Las advertencias nunca bloquean y no aparecen en la lista. A
 * diferencia de `LoginAccount`, es una consulta pura: no reincorpora la
 * cuenta cuando la suspension ya vencio -esa reincorporacion es un efecto de
 * iniciar sesion, no de que otro servicio pregunte.
 */
export class GetActiveSanctionStatus {
  constructor(
    private readonly accounts: AccountRepositoryPort,
    private readonly sanctions: SanctionRepositoryPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(subject: string): Promise<ActiveSanctionStatus> {
    const account = await this.accounts.findBySubject(subject)

    if (account === null) {
      throw new AccountNotFoundError(
        subject,
        'El testimonio no tiene ninguna cuenta asociada en este servicio.',
      )
    }

    const status = account.currentStatus

    if (status !== AccountStatus.Banned && status !== AccountStatus.Suspended) {
      return { hasActiveSanctions: false, sanctions: [] }
    }

    const restrictions = await this.sanctions.findActiveRestrictions(
      account.id.value,
      this.clock.now(),
    )

    const expectedType =
      status === AccountStatus.Banned ? SanctionType.PermanentBan : SanctionType.TemporarySuspension
    const sanctions = restrictions.filter((sanction) => sanction.type === expectedType)

    return {
      hasActiveSanctions: status === AccountStatus.Banned || sanctions.length > 0,
      sanctions,
    }
  }
}
