import { ApiProperty } from '@nestjs/swagger'
import { IsIn, IsNotEmpty, IsString } from 'class-validator'

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
}