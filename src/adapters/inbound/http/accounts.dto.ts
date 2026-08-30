import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { Allow, IsBoolean, IsEmail, IsString, MaxLength, MinLength } from 'class-validator'

/**
 * Contrato de entrada del registro (multipart/form-data).
 *
 * La validacion aqui es de forma. Las reglas de negocio viven en dominio y
 * en RegisterAccount.
 */
export class RegisterAccountRequest {
  @ApiProperty({ example: 'Ana' })
  @IsString()
  firstNames!: string

  @ApiProperty({ example: 'Ramirez' })
  @IsString()
  lastNames!: string

  @ApiProperty({ example: 'jugador@nexus.test', maxLength: 254 })
  @IsEmail({}, { message: 'El correo debe tener un formato valido.' })
  @MaxLength(254)
  email!: string

  /**
   * Se transporta a Cognito por `signUp` y NO se persiste aqui (ADR-004,
   * decision 2). La politica la aplica el proveedor: un rechazo suyo llega como
   * 400. Aqui solo se exige que exista y tenga una longitud minima razonable,
   * sin duplicar la politica -que vive en el pool y podria cambiar-.
   */
  @ApiProperty({ example: 'Abcdefg1!', minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string

  @ApiProperty({ example: 'Ana Ramirez', description: 'Apodo (display_name)', maxLength: 32 })
  @IsString()
  @MaxLength(32)
  nickname!: string

  @ApiProperty({ example: true })
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  termsAccepted!: boolean

  @ApiProperty({
    example:
      '[{"questionId":"sq-01","answer":"..."},{"questionId":"sq-02","answer":"..."},{"questionId":"sq-03","answer":"..."},{"questionId":"sq-04","answer":"..."}]',
  })
  @IsString()
  securityAnswers!: string

  /**
   * El archivo lo lee FileInterceptor, no este DTO. @Allow evita que el
   * ValidationPipe (forbidNonWhitelisted) trate la parte multipart como
   * campo extra. La regla image/* y el tamano viven en el dominio.
   */
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: 'Avatar obligatorio (image/*, maximo 500 MB)',
  })
  @Allow()
  avatar?: unknown
}

export class AccountResponse {
  @ApiProperty({ example: '0b1d5b0e-3f6a-4a1e-9a1a-4a5c6f2b8e10' })
  readonly id!: string

  @ApiProperty({ example: 'jugador@nexus.test' })
  readonly email!: string

  @ApiProperty({ example: 'Ana Ramirez' })
  readonly displayName!: string

  @ApiProperty({ example: 'Ana' })
  readonly firstNames!: string

  @ApiProperty({ example: 'Ramirez' })
  readonly lastNames!: string

  @ApiProperty({
    example: 'PENDING_VERIFICATION',
    enum: ['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED'],
  })
  readonly status!: string

  @ApiProperty({ example: ['PLAYER'], isArray: true, type: String })
  readonly roles!: readonly string[]
}

export class ConfirmRegistrationRequest {
  @ApiProperty({ description: 'Correo o apodo con el que se registro.' })
  @IsString()
  identifier!: string

  @ApiProperty({ example: '123456', description: 'Codigo que Cognito envio al correo.' })
  @IsString()
  code!: string
}
