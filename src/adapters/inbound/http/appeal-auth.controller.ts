import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'

import { AuthenticateForAppeal } from '../../../application/use-cases/AuthenticateForAppeal'
import { Public } from './auth/decorators'
import { AUTHENTICATE_FOR_APPEAL } from './tokens'
import { AppealAccessTokenResponse, AuthenticateForAppealRequest } from './appeals.dto'

/**
 * Autenticacion de alcance restringido para apelar (HU-42, §6: "identidad
 * restringida"). Deliberadamente `@Public()`: el `JwtAuthGuard` global no
 * debe intervenir aqui -quien llega SIN testimonio es justo a quien esto
 * sirve-, y la proteccion real es que exige la misma contrasena que el login
 * normal verifica contra el proveedor de identidad.
 */
@ApiTags('appeals')
@Controller('accounts/appeals/auth')
export class AppealAuthController {
  constructor(
    @Inject(AUTHENTICATE_FOR_APPEAL)
    private readonly authenticateForAppeal: AuthenticateForAppeal,
  ) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Autentica a un titular sancionado para presentar o consultar una apelacion',
  })
  @ApiResponse({ status: 200, type: AppealAccessTokenResponse })
  @ApiResponse({ status: 401, description: 'Credenciales invalidas' })
  async authenticate(
    @Body() body: AuthenticateForAppealRequest,
  ): Promise<AppealAccessTokenResponse> {
    const outcome = await this.authenticateForAppeal.execute({
      identifier: body.identifier,
      password: body.password,
    })

    if (outcome.kind === 'appealAuthenticated') {
      return { appealToken: outcome.appealToken, expiresIn: outcome.expiresIn }
    }

    if (outcome.kind === 'invalidCredentials') {
      throw new UnauthorizedException('Identificador o contrasena incorrectos.')
    }

    if (outcome.kind === 'secondFactorNotSupportedForAppeal') {
      throw new UnauthorizedException(
        'Esta cuenta requiere segundo factor. Usa el inicio de sesion normal mientras tu ' +
          'testimonio siga vigente para presentar la apelacion.',
      )
    }

    throw new ServiceUnavailableException('El proveedor de identidad no esta disponible.')
  }
}
