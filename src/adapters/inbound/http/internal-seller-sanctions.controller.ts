import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
} from '@nestjs/common'
import { ApiExcludeController, ApiOperation, ApiProperty, ApiResponse } from '@nestjs/swagger'

import type { GetActiveSanctionStatus } from '../../../application/use-cases/GetActiveSanctionStatus'
import { AccountNotFoundError } from '../../../application/errors/ApplicationError'
import type { SanctionType } from '../../../domain/entities/SanctionType'
import type { SanctionReasonCode } from '../../../domain/entities/SanctionReasonCode'
import { InternalOnly, Public } from './auth/decorators'
import { GET_ACTIVE_SANCTION_STATUS } from './tokens'

export class ActiveSanctionEntryResponse {
  @ApiProperty()
  readonly id!: string

  @ApiProperty({ enum: ['PERMANENT_BAN', 'TEMPORARY_SUSPENSION'] })
  readonly type!: SanctionType

  @ApiProperty({ enum: ['OTHER', 'AUCTION_TERMS_VIOLATION'] })
  readonly reasonCode!: SanctionReasonCode

  @ApiProperty({
    nullable: true,
    description: 'Fin de una suspension temporal. Null para un veto permanente.',
  })
  readonly expiresAt!: Date | null
}

export class ActiveSanctionStatusResponse {
  @ApiProperty({
    description:
      'Cierto si la cuenta esta bloqueada por PERMANENT_BAN o TEMPORARY_SUSPENSION vigente.',
  })
  readonly hasActiveSanctions!: boolean

  @ApiProperty({
    type: [ActiveSanctionEntryResponse],
    description: 'Sanciones que bloquean ahora mismo la cuenta. Las advertencias no aparecen aqui.',
  })
  readonly sanctions!: readonly ActiveSanctionEntryResponse[]
}

/**
 * Contrato INTERNO entre servicios (HU-62).
 *
 * Lo consume Auction para decidir si un vendedor puede publicar una subasta,
 * sin duplicar el modelo de sanciones (HU-42) ni exponerlo publicamente.
 * Mismo patron que `InternalBattleProfileController`: `@Public()` excluye la
 * ruta del guard de testimonios de usuario, `@InternalOnly()` la somete a
 * `InternalServiceGuard` (firma HMAC), y `@ApiExcludeController` la mantiene
 * fuera de la documentacion publica.
 *
 * ES UNA CONSULTA PURA: a diferencia de `LoginAccount`, no reincorpora la
 * cuenta cuando una suspension ya vencio. Ese efecto pertenece a iniciar
 * sesion, no a que otro servicio pregunte por el estado.
 */
@ApiExcludeController()
@Controller('internal/accounts')
export class InternalSellerSanctionsController {
  constructor(
    @Inject(GET_ACTIVE_SANCTION_STATUS)
    private readonly getActiveSanctionStatus: GetActiveSanctionStatus,
  ) {}

  @Public()
  @InternalOnly()
  @Get(':subject/active-sanctions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Indica si el sujeto tiene una sancion activa (interno)' })
  @ApiResponse({
    status: 200,
    description: 'Estado de sancion activa',
    type: ActiveSanctionStatusResponse,
  })
  @ApiResponse({ status: 401, description: 'Peticion interna no autorizada' })
  @ApiResponse({ status: 404, description: 'El sujeto no tiene cuenta en este servicio' })
  @ApiResponse({ status: 503, description: 'El contrato interno no esta configurado' })
  async activeSanctions(@Param('subject') subject: string): Promise<ActiveSanctionStatusResponse> {
    try {
      const status = await this.getActiveSanctionStatus.execute(subject)

      return {
        hasActiveSanctions: status.hasActiveSanctions,
        sanctions: status.sanctions.map((sanction) => ({
          id: sanction.id,
          type: sanction.type,
          reasonCode: sanction.reasonCode,
          expiresAt: sanction.expiresAt,
        })),
      }
    } catch (error: unknown) {
      if (error instanceof AccountNotFoundError) {
        throw new NotFoundException(error.message)
      }

      throw error
    }
  }
}
