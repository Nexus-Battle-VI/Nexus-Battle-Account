import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsNotEmpty, IsString } from 'class-validator'

import { ALL_APPEAL_DECISIONS, type AppealDecision } from '../../../domain/entities/AppealDecision'
import type { AppealStatus } from '../../../domain/entities/AppealStatus'

export class AuthenticateForAppealRequest {
  @ApiProperty({ example: 'jugador.sancionado@nexus.test' })
  @IsString()
  @IsNotEmpty()
  readonly identifier!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  readonly password!: string
}

export class AppealAccessTokenResponse {
  @ApiProperty()
  readonly appealToken!: string

  @ApiProperty({ description: 'Vigencia del token de apelacion en segundos.' })
  readonly expiresIn!: number
}

export class SubmitAppealRequest {
  @ApiProperty({ description: 'La sancion que se apela.' })
  @IsString()
  @IsNotEmpty()
  readonly sanctionId!: string

  @ApiProperty({
    description: 'Justificacion del titular para apelar la sancion.',
    example: 'La causal no corresponde a mi conducta, adjunto el contexto completo.',
  })
  @IsString()
  @IsNotEmpty()
  readonly statement!: string
}

export class ResolveAppealRequest {
  @ApiProperty({ enum: ALL_APPEAL_DECISIONS })
  @IsString()
  @IsIn(ALL_APPEAL_DECISIONS)
  readonly decision!: AppealDecision

  @ApiProperty({
    description: 'Justificacion de la decision, comunicada al titular.',
    example: 'Se revisaron los registros de chat y la sancion esta debidamente fundamentada.',
  })
  @IsString()
  @IsNotEmpty()
  readonly notes!: string
}

export class AppealResponse {
  @ApiProperty()
  readonly id!: string

  @ApiProperty()
  readonly sanctionId!: string

  @ApiProperty()
  readonly accountId!: string

  @ApiProperty()
  readonly statement!: string

  @ApiProperty()
  readonly submittedAt!: Date

  @ApiProperty({
    description:
      'Fecha de referencia para la decision final, 15 dias habiles (lunes a viernes) desde la ' +
      'presentacion. Provisional: no excluye festivos, por falta de un calendario formalmente aprobado.',
  })
  readonly decisionDueAt!: Date

  @ApiProperty()
  readonly status!: AppealStatus

  @ApiPropertyOptional({ enum: ALL_APPEAL_DECISIONS, nullable: true })
  readonly decision!: AppealDecision | null

  @ApiPropertyOptional({ nullable: true })
  readonly resolutionNotes!: string | null

  @ApiPropertyOptional({ nullable: true })
  readonly resolvedByAccountId!: string | null

  @ApiPropertyOptional({ nullable: true })
  readonly resolvedAt!: Date | null
}
