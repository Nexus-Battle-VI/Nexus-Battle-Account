import { Controller, Get, Inject, NotFoundException } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'

import { GetActiveSanctionStatus } from '../../../application/use-cases/GetActiveSanctionStatus'
import { AccountNotFoundError } from '../../../application/errors/ApplicationError'
import { CLOCK, type ClockPort } from '../../../application/ports/ClockPort'
import { AllowSanctionedSelf, CurrentIdentity, ReadOnlyAccountQuery } from './auth/decorators'
import type { VerifiedIdentity } from '../../../application/ports/TokenVerifierPort'
import { GET_ACTIVE_SANCTION_STATUS } from './tokens'
import { MySanctionStatusResponse } from './sanctions.dto'

/**
 * Autoservicio de sanciones del propio titular (HU-42, §7.3.2: "contador
 * visible del tiempo restante de suspension").
 *
 * Separado de `SanctionsController` (que aplica sanciones sobre OTRA cuenta,
 * `accounts/:id/sanctions`): aqui el titular solo lee su propio estado, nunca
 * el de otra cuenta, y por eso puede hacerlo aunque este suspendido o baneado
 * -@AllowSanctionedSelf()-. No expone nada mas: ni inventario, ni comercio,
 * ni ninguna otra capacidad.
 */
@ApiTags('sanctions')
@ApiBearerAuth()
@Controller('accounts/me/sanctions')
export class MySanctionsController {
  constructor(
    @Inject(GET_ACTIVE_SANCTION_STATUS)
    private readonly getActiveSanctionStatus: GetActiveSanctionStatus,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  @Get('active')
  @AllowSanctionedSelf()
  @ReadOnlyAccountQuery()
  @ApiOperation({
    summary: 'Consulta el estado de sancion activa del propio titular, con tiempo restante',
  })
  @ApiResponse({ status: 200, type: MySanctionStatusResponse })
  @ApiResponse({ status: 401, description: 'Falta el testimonio o no es valido' })
  @ApiResponse({ status: 404, description: 'El sujeto no tiene cuenta en este servicio' })
  async active(
    @CurrentIdentity() identity: VerifiedIdentity,
  ): Promise<MySanctionStatusResponse> {
    try {
      const status = await this.getActiveSanctionStatus.execute(identity.subject)
      const now = this.clock.now()

      const withDeadline = status.sanctions.find((sanction) => sanction.expiresAt !== null)
      const remainingSeconds =
        withDeadline?.expiresAt !== null && withDeadline?.expiresAt !== undefined
          ? Math.max(0, Math.round((withDeadline.expiresAt.getTime() - now.getTime()) / 1000))
          : null

      return {
        hasActiveSanctions: status.hasActiveSanctions,
        sanctions: status.sanctions.map((sanction) => sanction.toSnapshot()),
        remainingSeconds,
      }
    } catch (error: unknown) {
      if (error instanceof AccountNotFoundError) {
        throw new NotFoundException(error.message)
      }

      throw error
    }
  }
}
