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

import { PasswordChangeError } from '../../../application/ports/PasswordChangePort'
import { ChangeOwnPassword } from '../../../application/use-cases/ChangeOwnPassword'
import { CurrentAccessToken } from './auth/decorators'
import { CHANGE_OWN_PASSWORD } from './tokens'
import { ChangePasswordRequest } from './accounts.dto'

/**
 * Cambio de contrasena de la cuenta propia (HU-05).
 *
 * La contrasena NO pertenece a `Account` ni a PostgreSQL: esta ruta actua sobre
 * el testimonio de acceso de quien llama -igual que la inscripcion TOTP-, que el
 * proveedor de identidad exige para reemplazar su propia credencial. No se
 * persiste, no se registra y no se devuelve.
 *
 * Nace PROTEGIDA -el guard es global- y no lleva `@Roles`: cualquier identidad
 * autenticada cambia SU contrasena. No acepta un identificador del cuerpo: la
 * identidad es la del testimonio.
 */
@ApiTags('accounts')
@ApiBearerAuth()
@Controller('accounts/me')
export class PasswordController {
  constructor(@Inject(CHANGE_OWN_PASSWORD) private readonly changeOwnPassword: ChangeOwnPassword) {}

  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cambia la contrasena de la cuenta propia (HU-05)' })
  @ApiResponse({ status: 204, description: 'Contrasena cambiada' })
  @ApiResponse({
    status: 400,
    description: 'La contrasena actual no es correcta o la nueva no cumple la politica',
  })
  @ApiResponse({ status: 401, description: 'Falta el testimonio o no es valido' })
  @ApiResponse({ status: 503, description: 'El proveedor de identidad no respondio' })
  async change(
    @CurrentAccessToken() accessToken: string,
    @Body() body: ChangePasswordRequest,
  ): Promise<void> {
    let outcome
    try {
      outcome = await this.changeOwnPassword.execute({
        accessToken,
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
      })
    } catch (error: unknown) {
      throw PasswordController.translate(error)
    }

    if (outcome.kind === 'invalidCurrentPassword') {
      throw new BadRequestException('La contrasena actual no es correcta.')
    }

    if (outcome.kind === 'weakPassword') {
      throw new BadRequestException(outcome.reason)
    }
  }

  private static translate(error: unknown): Error {
    /**
     * El proveedor no respondio, limito los intentos o el token no lleva el
     * scope necesario: NO es 500. El servicio funciona, la dependencia no, y el
     * intento tiene sentido mas tarde.
     */
    if (error instanceof PasswordChangeError) {
      return new ServiceUnavailableException(
        'El proveedor de identidad no esta disponible. Intentelo de nuevo mas tarde.',
      )
    }

    return error instanceof Error ? error : new Error('Fallo desconocido del servicio.')
  }
}
