import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
  Allow,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator'

import {
  AccountStatus,
  type AccountStatus as AccountStatusValue,
} from '../../../domain/entities/AccountStatus'
import { Role, type Role as RoleValue } from '../../../domain/entities/Role'
import { DisplayName } from '../../../domain/value-objects/DisplayName'
import type { AdminAccountStatusCountsDto } from '../../../application/dto/AdminAccountSummaryDto'

const ACCOUNT_STATUS_VALUES = Object.values(AccountStatus)

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

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'CO',
    description: 'País declarado, ISO 3166-1 alpha-2; null si no se conoce.',
  })
  readonly countryCode!: string | null

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

/**
 * Contrato de la actualizacion self-service de la cuenta propia (HU-05).
 *
 * Declara EXCLUSIVAMENTE los campos que hoy se implementan. Con
 * `forbidNonWhitelisted` en el ValidationPipe global, cualquier otro campo
 * -`id`, `accountId`, `subject`, `status`, `roles`, `termsAccepted`...- hace que
 * la peticion se rechace con 400. La cuenta se resuelve por el testimonio, no
 * por el cuerpo.
 */
export class UpdateOwnAccountRequest {
  @ApiPropertyOptional({
    example: 'Ana Ramirez',
    description: 'Nuevo apodo (display_name).',
    minLength: DisplayName.MIN_LENGTH,
    maxLength: DisplayName.MAX_LENGTH,
  })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(DisplayName.MIN_LENGTH)
  @MaxLength(DisplayName.MAX_LENGTH)
  displayName?: string

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'CO',
    description: 'País ISO alpha-2. Omitido conserva el actual; null lo borra.',
  })
  @IsOptional()
  @IsString()
  countryCode?: string | null
}

export class FindAccountByEmailQuery {
  @ApiProperty({ example: 'jugador@nexus.test' })
  @IsEmail({}, { message: 'El correo debe tener un formato valido.' })
  @MaxLength(254)
  email!: string
}

export class AssignRoleRequest {
  @ApiProperty({ enum: [Role.Moderator, Role.Administrator], example: Role.Moderator })
  @IsString()
  @IsIn([Role.Moderator, Role.Administrator], {
    message: 'El rol debe ser MODERATOR o ADMINISTRATOR.',
  })
  role!: RoleValue
}

export class ManagedAccountResponse extends AccountResponse {
  @ApiProperty({
    example: true,
    description: 'Indica si Cognito confirma SOFTWARE_TOKEN_MFA para la cuenta.',
  })
  readonly mfaEnrolled!: boolean
}

export class ListAdminAccountsQuery {
  @ApiPropertyOptional({ example: 'acc-123' })
  @IsOptional()
  @IsString()
  id?: string

  @ApiPropertyOptional({ example: 'jugador@nexus.test' })
  @IsOptional()
  @IsEmail({}, { message: 'El correo debe tener un formato valido.' })
  @MaxLength(254)
  email?: string

  @ApiPropertyOptional({ example: 'Ana' })
  @IsOptional()
  @IsString()
  firstNames?: string

  @ApiPropertyOptional({ example: 'Ramirez' })
  @IsOptional()
  @IsString()
  lastNames?: string

  @ApiPropertyOptional({ example: 'Ana Ramirez', description: 'Apodo (display_name)' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  nickname?: string

  @ApiPropertyOptional({ enum: Role, example: Role.Administrator })
  @IsOptional()
  @IsString()
  @IsIn(Object.values(Role), { message: 'El rol indicado no existe.' })
  role?: RoleValue

  @ApiPropertyOptional({ enum: ACCOUNT_STATUS_VALUES, example: AccountStatus.Active })
  @IsOptional()
  @IsString()
  @IsIn(ACCOUNT_STATUS_VALUES, { message: 'El estado indicado no existe.' })
  status?: AccountStatusValue
}

export class AdminAccountSummaryResponse {
  @ApiProperty({ example: '0b1d5b0e-3f6a-4a1e-9a1a-4a5c6f2b8e10' })
  readonly id!: string

  @ApiProperty({ example: 'jugador@nexus.test' })
  readonly email!: string

  @ApiProperty({ example: 'Ana Ramirez' })
  readonly displayName!: string

  @ApiProperty({ type: String, nullable: true, example: 'CO' })
  readonly countryCode!: string | null

  @ApiProperty({ example: 'Ana' })
  readonly firstNames!: string

  @ApiProperty({ example: 'Ramirez' })
  readonly lastNames!: string

  @ApiProperty({
    example: 'PENDING_VERIFICATION',
    enum: ACCOUNT_STATUS_VALUES,
  })
  readonly status!: AccountStatusValue

  @ApiProperty({ example: ['PLAYER'], isArray: true, type: String })
  readonly roles!: readonly RoleValue[]

  @ApiProperty({ example: '2026-08-01T10:00:00.000Z' })
  readonly registeredAt!: string
}

export class AdminAccountStatusCountsResponse implements AdminAccountStatusCountsDto {
  @ApiProperty({ example: 1 })
  readonly pendingVerification!: number

  @ApiProperty({ example: 10 })
  readonly active!: number

  @ApiProperty({ example: 2 })
  readonly suspended!: number
}

export class AdminAccountsResponse {
  @ApiProperty({ type: [AdminAccountSummaryResponse] })
  readonly items!: readonly AdminAccountSummaryResponse[]

  @ApiProperty({ type: AdminAccountStatusCountsResponse })
  readonly statusCounts!: AdminAccountStatusCountsResponse
}

export class ConfirmRegistrationRequest {
  @ApiProperty({ description: 'Correo o apodo con el que se registro.' })
  @IsString()
  identifier!: string

  @ApiProperty({ example: '123456', description: 'Codigo que Cognito envio al correo.' })
  @IsString()
  code!: string
}

export class TotpEnrollmentResponse {
  @ApiProperty({
    example:
      'otpauth://totp/Nexus%20Battles%20VI:jugador@nexus.test?secret=JBSWY3DPEHPK3PXP&issuer=Nexus%20Battles%20VI&algorithm=SHA1&digits=6&period=30',
    description: 'URI otpauth para generar el QR. Contiene el secreto: es una credencial.',
  })
  readonly otpauthUri!: string

  @ApiProperty({
    example: 'JBSWY3DPEHPK3PXP',
    description: 'Clave base32 para introducir a mano si no se escanea el QR.',
  })
  readonly secret!: string
}

export class StartRecoveryRequest {
  @ApiProperty({ example: 'jugador@nexus.test' })
  @IsEmail({}, { message: 'El correo debe tener un formato valido.' })
  @MaxLength(254)
  email!: string
}

export class RecoveryAnswerItem {
  @ApiProperty({ example: 'sq-01' })
  @IsString()
  questionId!: string

  @ApiProperty({ example: 'luna' })
  @IsString()
  answer!: string
}

export class VerifyRecoveryAnswersRequest {
  @ApiProperty()
  @IsString()
  challengeToken!: string

  @ApiProperty({ type: [RecoveryAnswerItem] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecoveryAnswerItem)
  answers!: RecoveryAnswerItem[]
}

export class VerifyRecoveryCodeRequest {
  @ApiProperty()
  @IsString()
  challengeToken!: string

  @ApiProperty({ example: '000000' })
  @IsString()
  code!: string
}

export class ResetRecoveryPasswordRequest {
  @ApiProperty()
  @IsString()
  challengeToken!: string

  @ApiProperty({ example: 'Abcdefg1!' })
  @IsString()
  password!: string
}

export class RecoveryQuestionResponse {
  @ApiProperty({ example: 'sq-01' })
  readonly id!: string

  @ApiProperty({ example: '¿Cuál era el nombre de tu primera mascota?' })
  readonly statement!: string
}

export class StartRecoveryResponse {
  @ApiProperty()
  readonly challengeToken!: string

  @ApiProperty({ type: [RecoveryQuestionResponse] })
  readonly questions!: readonly RecoveryQuestionResponse[]
}

export class RecoveryChallengeResponse {
  @ApiProperty()
  readonly challengeToken!: string
}

export class RecoveryResetResponse {
  @ApiProperty({ example: 'RESET' })
  readonly status!: 'RESET'
}

export class ConfirmTotpRequest {
  @ApiProperty({ example: '123456', description: 'Codigo de seis digitos del autenticador.' })
  @IsString()
  @Matches(/^\d{6}$/u, { message: 'El codigo debe tener exactamente seis digitos.' })
  code!: string
}

/**
 * Contrato del cambio de contrasena de la cuenta propia (HU-05).
 *
 * La identidad se toma del testimonio, no del cuerpo: no acepta `accountId`,
 * `email`, `subject`, `username` ni `role`. Las contrasenas NO se registran ni
 * se devuelven; los ejemplos son ficticios.
 *
 * La validacion aqui es solo de FORMA (cadena, no vacia). La politica de
 * fortaleza -longitud, complejidad- la aplica el proveedor de identidad, que es
 * la autoridad vigente del sistema, igual que en el alta. No se declara un
 * minimo local: seria una segunda politica, sin fuente funcional que la respalde
 * y capaz de divergir del pool.
 */
export class ChangePasswordRequest {
  @ApiProperty({
    example: 'Contrasena-Actual-Ficticia-1',
    description: 'Contrasena vigente. Nunca se registra ni se devuelve.',
  })
  @IsString()
  @MinLength(1)
  currentPassword!: string

  @ApiProperty({
    example: 'Contrasena-Nueva-Ficticia-1',
    description: 'Contrasena nueva. La politica de fortaleza la aplica el proveedor de identidad.',
  })
  @IsString()
  @MinLength(1)
  newPassword!: string
}

/**
 * Confirma RECEPCION de la solicitud de eliminacion (HU-43.2), nunca cierre.
 * No incluye `accountId`: quien pregunta ya es el titular, resuelto desde el
 * testimonio, no desde un identificador que el cliente aporte.
 */
export class AccountDeletionRequestResponse {
  @ApiProperty({ example: '3b2f6f2a-8b8a-4a7a-9d3f-2f6a1e0c9b7d' })
  readonly id!: string

  @ApiProperty({
    example: 'RECEIVED',
    enum: ['RECEIVED', 'IN_PROGRESS', 'FAILED', 'CLOSED'],
    description: 'Estado interno del tratamiento dentro de Account (ADR-014 Decision 5).',
  })
  readonly status!: string

  @ApiProperty({
    example: '2026-09-03T12:00:00.000Z',
    description: 'Fecha y hora de recepcion, generada por el backend.',
  })
  readonly receivedAt!: string
}
