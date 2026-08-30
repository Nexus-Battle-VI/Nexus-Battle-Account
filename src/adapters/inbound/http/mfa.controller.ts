import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'

import { TotpEnrollmentError } from '../../../application/ports/TotpEnrollmentPort'
import type { VerifiedIdentity } from '../../../application/ports/TokenVerifierPort'
import { EnrollTotp } from '../../../application/use-cases/EnrollTotp'
import { ConfirmTotpEnrollment } from '../../../application/use-cases/ConfirmTotpEnrollment'
import { CurrentAccessToken, CurrentIdentity } from './auth/decorators'
import { CONFIRM_TOTP_ENROLLMENT, ENROLL_TOTP } from './tokens'
import { ConfirmTotpRequest, TotpEnrollmentResponse } from './accounts.dto'

/**
 * Inscripcion del segundo factor por aplicacion autenticadora (TOTP), entera
 * dentro de la UI del producto.
 *
 * Ambas rutas nacen PROTEGIDAS -el guard es global- y actuan sobre el testimonio
 * de quien llama, no sobre un identificador del cuerpo: se inscribe uno mismo su
 * autenticador, nunca el de otro. Sin `@Roles`: cualquier identidad autenticada
 * puede inscribir su TOTP, incluido un PLAYER. Es el orden que exige el
 * gobierno: inscribir siendo PLAYER y elevar despues (HU-39). Inscribir NO
 * eleva: aqui no se toca `account_roles` ni ningun grupo.
 */
@ApiTags('mfa')
@ApiBearerAuth()
@Controller('accounts/mfa')
export class MfaController {
  constructor(
    @Inject(ENROLL_TOTP) private readonly enrollTotp: EnrollTotp,
    @Inject(CONFIRM_TOTP_ENROLLMENT) private readonly confirmTotp: ConfirmTotpEnrollment,
  ) {}

  @Post('totp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Asocia un autenticador TOTP y devuelve el secreto a inscribir' })
  @ApiResponse({ status: 200, description: 'Autenticador asociado', type: TotpEnrollmentResponse })
  @ApiResponse({ status: 401, description: 'Falta el testimonio o no es valido' })
  @ApiResponse({ status: 503, description: 'El proveedor de identidad no respondio' })
  async enroll(
    @CurrentAccessToken() accessToken: string,
    @CurrentIdentity() identity: VerifiedIdentity,
  ): Promise<TotpEnrollmentResponse> {
    try {
      return await this.enrollTotp.execute({ accessToken, subject: identity.subject })
    } catch (error: unknown) {
      throw MfaController.translate(error)
    }
  }

  @Post('totp/verification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verifica el primer codigo y deja TOTP como factor preferido' })
  @ApiResponse({ status: 200, description: 'Autenticador confirmado' })
  @ApiResponse({ status: 400, description: 'El codigo no es valido' })
  @ApiResponse({ status: 401, description: 'Falta el testimonio o no es valido' })
  @ApiResponse({ status: 503, description: 'El proveedor de identidad no respondio' })
  async confirm(
    @CurrentAccessToken() accessToken: string,
    @Body() body: ConfirmTotpRequest,
  ): Promise<{ readonly status: 'CONFIRMED' }> {
    let outcome
    try {
      outcome = await this.confirmTotp.execute({ accessToken, code: body.code })
    } catch (error: unknown) {
      throw MfaController.translate(error)
    }

    if (outcome.kind === 'invalidCode') {
      throw new BadRequestException('El codigo del autenticador no es valido.')
    }

    return { status: 'CONFIRMED' }
  }

  private static translate(error: unknown): Error {
    /**
     * El proveedor no respondio: NO es 500. El servicio funciona, la dependencia
     * no, y el intento tiene sentido mas tarde. Un token sin el scope necesario
     * tambien cae aqui -es un problema de la sesion, no un defecto del servicio-.
     */
    if (error instanceof TotpEnrollmentError) {
      return new ServiceUnavailableException(
        'El proveedor de identidad no esta disponible. Intentelo de nuevo mas tarde.',
      )
    }

    return error instanceof Error ? error : new Error('Fallo desconocido del servicio.')
  }
}
