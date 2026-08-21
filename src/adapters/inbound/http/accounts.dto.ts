import { ApiProperty } from '@nestjs/swagger'
import { IsEmail, IsString, Length, MaxLength } from 'class-validator'

/**
 * Contrato de entrada del registro de cuentas.
 *
 * La validacion aqui es de forma, no de negocio: comprueba que la peticion sea
 * sintacticamente utilizable. Las reglas de negocio siguen viviendo en los
 * objetos de valor del dominio, que se aplican igualmente aunque la peticion
 * llegue por otro adaptador.
 */
export class RegisterAccountRequest {
  @ApiProperty({ example: 'jugador@nexus.test', maxLength: 254 })
  @IsEmail({}, { message: 'El correo debe tener un formato valido.' })
  @MaxLength(254)
  email!: string

  @ApiProperty({ example: 'Ana Ramirez', minLength: 3, maxLength: 32 })
  @IsString()
  @Length(3, 32, { message: 'El nombre visible debe tener entre 3 y 32 caracteres.' })
  displayName!: string
}

export class AccountResponse {
  @ApiProperty({ example: '0b1d5b0e-3f6a-4a1e-9a1a-4a5c6f2b8e10' })
  readonly id!: string

  @ApiProperty({ example: 'jugador@nexus.test' })
  readonly email!: string

  @ApiProperty({ example: 'Ana Ramirez' })
  readonly displayName!: string

  @ApiProperty({
    example: 'PENDING_VERIFICATION',
    enum: ['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED'],
  })
  readonly status!: string

  @ApiProperty({ example: ['PLAYER'], isArray: true, type: String })
  readonly roles!: readonly string[]
}
