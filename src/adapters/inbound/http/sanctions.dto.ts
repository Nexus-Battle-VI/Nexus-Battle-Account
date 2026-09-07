import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator'

import {
  ALL_SANCTION_TYPES,
  type SanctionType,
} from '../../../domain/entities/SanctionType'

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

  @ApiProperty()
  readonly createdAt!: Date

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Fecha de finalizacion de una suspension temporal. Es null para advertencias y baneos.',
  })
  readonly expiresAt!: Date | null
}