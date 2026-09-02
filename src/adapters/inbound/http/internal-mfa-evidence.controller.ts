import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common'
import { ApiExcludeController, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

import type { VerifyMfaEvidence } from '../../../application/use-cases/VerifyMfaEvidence'
import { InternalOnly, Public } from './auth/decorators'
import { VERIFY_MFA_EVIDENCE } from './tokens'
import {
  SecondFactorMethod,
  type SecondFactorMethod as SecondFactorMethodValue,
} from '../../../domain/entities/SecondFactorMethod'

export class VerifyMfaEvidenceRequest {
  @ApiProperty({ description: 'Sujeto (`sub`) del testimonio a comprobar.' })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  subject!: string

  @ApiProperty({ description: 'Identificador (`jti`) del testimonio a comprobar.' })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  jti!: string

  @ApiProperty({
    enum: SecondFactorMethod,
    description: 'Metodo de segundo factor que la operacion exige comprobar.',
  })
  @IsEnum(SecondFactorMethod)
  method!: SecondFactorMethodValue
}

export class VerifyMfaEvidenceResponse {
  @ApiProperty({
    description: 'Cierto solo si sujeto, `jti`, metodo y vigencia coinciden.',
  })
  valid!: boolean
}

/**
 * Contrato INTERNO entre servicios. No forma parte de la API de usuario.
 *
 * Lo consume otro servicio del sistema para decidir si una operacion
 * administrativa puede continuar. Nunca lo llama Web, y no se documenta en la
 * especificacion publica: `@ApiExcludeController` lo mantiene fuera para que no
 * aparezca como algo que un cliente pueda usar.
 *
 * `@Public()` NO significa abierto. Excluye la ruta del guard de testimonios de
 * usuario -quien llama es un servicio, no una persona, y no trae JWT-, y
 * `@InternalOnly()` la somete a `InternalServiceGuard`, que exige firma HMAC
 * valida. Sin esa segunda marca la ruta seria consultable por cualquiera.
 *
 * LA RESPUESTA ES UN BOOLEANO. No se devuelve cuando se verifico el factor, ni
 * cuando expira, ni a que cuenta pertenece: quien pregunta no lo necesita para
 * decidir, y devolverlo filtraria informacion de autenticacion fuera del
 * contexto que la posee.
 */
@ApiExcludeController()
@Controller('internal/mfa-evidence')
export class InternalMfaEvidenceController {
  constructor(@Inject(VERIFY_MFA_EVIDENCE) private readonly verifyMfaEvidence: VerifyMfaEvidence) {}

  @Public()
  @InternalOnly()
  @Post('verification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Comprueba la evidencia de segundo factor de un testimonio (interno)' })
  @ApiResponse({ status: 200, description: 'Resultado de la comprobacion' })
  @ApiResponse({ status: 401, description: 'Peticion interna no autorizada' })
  @ApiResponse({ status: 503, description: 'El contrato interno no esta configurado' })
  async verify(@Body() body: VerifyMfaEvidenceRequest): Promise<VerifyMfaEvidenceResponse> {
    return {
      valid: await this.verifyMfaEvidence.execute({
        subject: body.subject,
        jti: body.jti,
        method: body.method,
      }),
    }
  }
}
