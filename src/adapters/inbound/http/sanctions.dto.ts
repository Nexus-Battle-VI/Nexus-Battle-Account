import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString } from 'class-validator'

import { ALL_SANCTION_TYPES, type SanctionType } from '../../../domain/entities/SanctionType'
import {
  ALL_SANCTION_REASON_CODES,
  type SanctionReasonCode,
} from '../../../domain/entities/SanctionReasonCode'

export class ApplySanctionRequest {
  @ApiProperty({
    enum: ALL_SANCTION_TYPES,
    example: 'WARNING',
  })
  @IsString()
  @IsIn(ALL_SANCTION_TYPES)
  readonly type!: SanctionType

  @ApiProperty({
    example: 'Conducta ofensiva reiterada en la comunidad.',
  })
  @IsString()
  @IsNotEmpty()
  readonly reason!: string

  @ApiPropertyOptional({
    enum: ALL_SANCTION_REASON_CODES,
    default: 'OTHER',
    example: 'OTHER',
    description:
      'Código estructurado del motivo. Si se omite, la sanción se registra como OTHER. AUCTION_TERMS_VIOLATION solo cuenta para cancelar subastas cuando la sanción es una restricción activa.',
  })
  @IsOptional()
  @IsString()
  @IsIn(ALL_SANCTION_REASON_CODES)
  readonly reasonCode?: SanctionReasonCode

  @ApiPropertyOptional({
    description:
      'Duracion de la suspension temporal en minutos. Solo aplica a TEMPORARY_SUSPENSION.',
    example: 1440,
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  readonly suspensionDurationMinutes?: number
}

export class SanctionResponse {
  @ApiProperty()
  readonly id!: string

  @ApiProperty()
  readonly targetAccountId!: string

  @ApiProperty()
  readonly actorAccountId!: string

  @ApiProperty({
    enum: ALL_SANCTION_TYPES,
  })
  readonly type!: SanctionType

  @ApiProperty()
  readonly reason!: string

  @ApiProperty({
    enum: ALL_SANCTION_REASON_CODES,
  })
  readonly reasonCode!: SanctionReasonCode

  @ApiProperty()
  readonly createdAt!: Date

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Fecha de finalizacion de una suspension temporal. Es null para advertencias y baneos.',
  })
  readonly expiresAt!: Date | null

  @ApiProperty({
    description:
      'Fecha limite hasta la cual el usuario sancionado puede ejercer la opcion de apelacion. Corresponde a 30 dias desde la aplicacion de la sancion.',
    example: '2026-10-06T12:00:00.000Z',
  })
  readonly appealDeadline!: Date
}
