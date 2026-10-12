import type { SanctionRepositoryPort } from '../ports/SanctionRepositoryPort'
import type { AppealRepositoryPort } from '../ports/AppealRepositoryPort'
import type { ClockPort } from '../ports/ClockPort'
import type { Sanction } from '../../domain/entities/Sanction'

/**
 * Sanciones de la propia cuenta que todavia pueden apelarse (HU-42, §6):
 * dentro del plazo de 30 dias Y sin una apelacion ya presentada.
 *
 * Existe para que la identidad restringida (`AuthenticateForAppeal`) permita
 * de verdad "seleccionar la sancion a apelar" en vez de exigir que quien
 * apela ya conozca el identificador de memoria -el unico lugar donde hoy
 * aparece es el correo de notificacion, que una cuenta baneada podria no
 * tener a mano-.
 */
export class GetAppealableSanctions {
  constructor(
    private readonly sanctions: SanctionRepositoryPort,
    private readonly appeals: AppealRepositoryPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(accountId: string): Promise<readonly Sanction[]> {
    const now = this.clock.now()
    const history = await this.sanctions.findByTargetAccountId(accountId)

    const appealable: Sanction[] = []

    for (const sanction of history) {
      if (!sanction.canAppeal(now)) {
        continue
      }

      const existing = await this.appeals.findBySanctionId(sanction.id)

      if (existing === null) {
        appealable.push(sanction)
      }
    }

    return appealable
  }
}
