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

import type { LoginOutcome } from '../../../application/dto/LoginResult'
import { CompleteSecondFactor } from '../../../application/use-cases/CompleteSecondFactor'
import { LoginAccount } from '../../../application/use-cases/LoginAccount'
import { Public } from './auth/decorators'
import { COMPLETE_SECOND_FACTOR, LOGIN_ACCOUNT } from './tokens'
import { LoginRequest, SecondFactorRequest, SessionResponse } from './sessions.dto'

/**
 * Sesiones (HU-02).
 *
 * Ambas rutas son publicas (`@Public()`): pedirlas exigiria ya tener una
 * sesion, lo cual es precisamente lo que todavia no existe en este punto.
 *
 * No hay traduccion de errores de dominio aqui como en `AccountsController`:
 * `LoginAccount`/`CompleteSecondFactor` devuelven un resultado explicito
 * (`LoginOutcome`) en lugar de lanzar excepciones para sus fallos esperados
 * -ver `application/dto/LoginResult.ts` para la justificacion-, asi que este
 * controlador solo traduce ESE resultado a HTTP con un `switch` exhaustivo.
 */
@ApiTags('sessions')
@Controller('sessions')
export class SessionsController {
  constructor(
    @Inject(LOGIN_ACCOUNT) private readonly loginAccount: LoginAccount,
    @Inject(COMPLETE_SECOND_FACTOR) private readonly completeSecondFactor: CompleteSecondFactor,
  ) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Inicia sesion con correo o apodo + contrasena (HU-02)' })
  @ApiResponse({
    status: 200,
    description: 'Autenticacion completada o segundo factor requerido.',
    type: SessionResponse,
  })
  @ApiResponse({ status: 400, description: 'Datos invalidos' })
  @ApiResponse({ status: 401, description: 'Credenciales invalidas' })
  @ApiResponse({ status: 503, description: 'El proveedor de identidad no esta disponible' })
  async login(@Body() body: LoginRequest): Promise<SessionResponse> {
    const outcome = await this.loginAccount.execute({
      identifier: body.identifier,
      password: body.password,
    })

    return SessionsController.translate(outcome)
  }

  @Public()
  @Post('second-factor')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Completa el segundo factor administrativo (HU-02, CA-07/CA-08)' })
  @ApiResponse({
    status: 200,
    description: 'Sesion administrativa completada.',
    type: SessionResponse,
  })
  @ApiResponse({ status: 400, description: 'Datos invalidos' })
  @ApiResponse({ status: 401, description: 'Codigo invalido, expirado o credenciales invalidas' })
  @ApiResponse({ status: 503, description: 'El proveedor de identidad no esta disponible' })
  async secondFactor(@Body() body: SecondFactorRequest): Promise<SessionResponse> {
    const outcome = await this.completeSecondFactor.execute({
      identifier: body.identifier,
      challengeToken: body.challengeToken,
      code: body.code,
    })

    return SessionsController.translate(outcome)
  }

  private static translate(outcome: LoginOutcome): SessionResponse {
    switch (outcome.kind) {
      case 'authenticated':
        return {
          status: 'AUTHENTICATED',
          accessToken: outcome.accessToken,
          account: {
            id: outcome.account.id,
            email: outcome.account.email,
            displayName: outcome.account.displayName,
            roles: outcome.account.roles,
          },
        }

      case 'secondFactorRequired':
        return { status: 'SECOND_FACTOR_REQUIRED', challengeToken: outcome.challengeToken }

      case 'invalidCredentials':
        throw new UnauthorizedException('Las credenciales no son validas.')

      case 'secondFactorInvalid':
        throw new UnauthorizedException('El segundo factor no es valido o ha expirado.')

      case 'providerUnavailable':
        throw new ServiceUnavailableException('El proveedor de identidad no esta disponible.')
    }
  }
}
