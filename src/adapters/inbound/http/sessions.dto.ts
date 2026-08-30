import { ApiProperty } from '@nestjs/swagger'
import { IsIn, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator'

/**
 * Contrato de entrada del login (HU-02).
 *
 * Deliberadamente NO declara un campo `role`: el `ValidationPipe` global
 * (`whitelist: true, forbidNonWhitelisted: true`) rechaza con 400 cualquier
 * peticion que incluya uno. El rol se lee siempre de la cuenta, nunca de la
 * entrada (CA-09).
 */
export class LoginRequest {
  @ApiProperty({
    example: 'jugador@nexus.test',
    description: 'Correo electronico o apodo de la cuenta.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  identifier!: string

  @ApiProperty({ example: 'Abcdefg1!' })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  password!: string
}

export class SecondFactorRequest {
  @ApiProperty({ example: 'jugador@nexus.test' })
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  identifier!: string

  @ApiProperty({ description: 'Token de reto devuelto por el login (opaco).' })
  @IsString()
  @MinLength(1)
  challengeToken!: string

  @ApiProperty({ description: 'Codigo del segundo factor.' })
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  code!: string
}

/**
 * `id` es el identificador de Account; `subject` es el `sub` real del
 * proveedor de identidad. Son valores DISTINTOS y nunca se mapea uno sobre el
 * otro. `AccountDto` (usado por `GET /accounts/:id` y `/me`) sigue sin llevar
 * `subject` -esas rutas no deben exponer el sujeto de una cuenta ajena-; aqui
 * es distinto: es la propia sesion recien creada, y `subject` ya viaja dentro
 * de `accessToken` como claim estandar del JWT, asi que no hay nada nuevo que
 * filtrar al declararlo tambien de forma explicita.
 */
export class AccountSummaryResponse {
  @ApiProperty({ example: '0b1d5b0e-3f6a-4a1e-9a1a-4a5c6f2b8e10' })
  readonly id!: string

  @ApiProperty({ example: 'us-east-1:3f2a8b1c-...' })
  readonly subject!: string

  @ApiProperty({ example: 'jugador@nexus.test' })
  readonly email!: string

  @ApiProperty({ example: 'Ana Ramirez' })
  readonly displayName!: string

  @ApiProperty({ example: ['PLAYER'], isArray: true, type: String })
  readonly roles!: readonly string[]
}

export class SessionResponse {
  @ApiProperty({
    enum: ['AUTHENTICATED', 'SECOND_FACTOR_REQUIRED', 'SECOND_FACTOR_SELECTION_REQUIRED'],
    description:
      'AUTHENTICATED: sesion completada, `accessToken` y `account` presentes. ' +
      'SECOND_FACTOR_REQUIRED: primera etapa superada, falta el segundo factor; ' +
      'solo `challengeToken` presente.',
  })
  readonly status!: 'AUTHENTICATED' | 'SECOND_FACTOR_REQUIRED' | 'SECOND_FACTOR_SELECTION_REQUIRED'

  @ApiProperty({
    required: false,
    description: 'Testimonio firmado por el proveedor de identidad.',
  })
  readonly accessToken?: string

  @ApiProperty({
    required: false,
    description: 'Vigencia de `accessToken` en segundos. Presente solo junto con `accessToken`.',
  })
  readonly expiresIn?: number

  @ApiProperty({ required: false, type: AccountSummaryResponse })
  readonly account?: AccountSummaryResponse

  @ApiProperty({
    required: false,
    description: 'Presente solo cuando status es SECOND_FACTOR_REQUIRED.',
  })
  readonly challengeToken?: string

  @ApiProperty({
    required: false,
    enum: ['AUTHENTICATOR_APP', 'EMAIL', 'SMS'],
    description:
      'Donde hay que mirar para obtener el codigo. Presente solo cuando status es ' +
      'SECOND_FACTOR_REQUIRED. Existe porque sin el la interfaz solo podia adivinar, ' +
      'y adivinaba mal: anunciaba un correo que nunca se enviaba.',
  })
  readonly secondFactorMethod?: 'AUTHENTICATOR_APP' | 'EMAIL' | 'SMS'

  @ApiProperty({
    required: false,
    isArray: true,
    enum: ['AUTHENTICATOR_APP', 'EMAIL', 'SMS'],
    description:
      'Factores entre los que hay que elegir. Presente solo cuando status es ' +
      'SECOND_FACTOR_SELECTION_REQUIRED. Elegir no autentica: devuelve el reto del ' +
      'factor elegido, que sigue habiendo que responder.',
  })
  readonly availableSecondFactors?: readonly ('AUTHENTICATOR_APP' | 'EMAIL' | 'SMS')[]
}

export class ChooseSecondFactorRequest {
  @ApiProperty({ description: 'Correo o apodo, igual que en el inicio de sesion.' })
  @IsString()
  @IsNotEmpty()
  identifier!: string

  @ApiProperty({ description: 'Testimonio de reto devuelto por la etapa anterior.' })
  @IsString()
  @IsNotEmpty()
  challengeToken!: string

  @ApiProperty({ enum: ['AUTHENTICATOR_APP', 'EMAIL', 'SMS'] })
  @IsIn(['AUTHENTICATOR_APP', 'EMAIL', 'SMS'])
  method!: 'AUTHENTICATOR_APP' | 'EMAIL' | 'SMS'
}
