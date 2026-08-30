import {
  Body,
  ForbiddenException,
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
import { CHOOSE_SECOND_FACTOR, COMPLETE_SECOND_FACTOR, LOGIN_ACCOUNT } from './tokens'
import { ChooseSecondFactor } from '../../../application/use-cases/ChooseSecondFactor'
import {
  LoginRequest,
  ChooseSecondFactorRequest,
  SecondFactorRequest,
  SessionResponse,
} from './sessions.dto'

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
    @Inject(CHOOSE_SECOND_FACTOR) private readonly chooseSecondFactor: ChooseSecondFactor,
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

  /**
   * Elegir NO autentica: devuelve el reto del factor elegido, que sigue
   * habiendo que responder en `second-factor`. Por eso es publica igual que las
   * otras dos: pedirla exigiria ya tener una sesion, que es lo que aun no hay.
   */
  @Public()
  @Post('second-factor/method')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Elige el segundo factor cuando el proveedor ofrece varios (HU-02)' })
  @ApiResponse({ status: 200, description: 'Reto del factor elegido.', type: SessionResponse })
  @ApiResponse({ status: 400, description: 'Datos invalidos' })
  @ApiResponse({ status: 401, description: 'Credenciales o reto invalidos' })
  @ApiResponse({ status: 503, description: 'El proveedor de identidad no esta disponible' })
  async chooseFactor(@Body() body: ChooseSecondFactorRequest): Promise<SessionResponse> {
    const outcome = await this.chooseSecondFactor.execute({
      identifier: body.identifier,
      challengeToken: body.challengeToken,
      method: body.method,
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
          expiresIn: outcome.expiresIn,
          account: {
            id: outcome.account.id,
            subject: outcome.subject,
            email: outcome.account.email,
            displayName: outcome.account.displayName,
            roles: outcome.account.roles,
          },
        }

      case 'secondFactorRequired':
        return {
          status: 'SECOND_FACTOR_REQUIRED',
          challengeToken: outcome.challengeToken,
          secondFactorMethod: outcome.method,
        }

      case 'secondFactorSelectionRequired':
        return {
          status: 'SECOND_FACTOR_SELECTION_REQUIRED',
          challengeToken: outcome.challengeToken,
          availableSecondFactors: outcome.methods,
        }

      case 'invalidCredentials':
        throw new UnauthorizedException('Las credenciales no son validas.')

      /**
       * 403 y no 401: las credenciales SI eran validas. Lo que no se admite es
       * el medio del segundo factor para esta cuenta. Devolver 401 haria pensar
       * en una contrasena mal escrita y llevaria a intentarlo otra vez sin
       * cambiar nada.
       */
      case 'secondFactorNotPermitted':
        throw new ForbiddenException(
          'Esta cuenta requiere una aplicacion autenticadora como segundo factor. ' +
            'Inscribe un autenticador antes de iniciar sesion.',
        )

      case 'secondFactorInvalid':
        throw new UnauthorizedException('El segundo factor no es valido o ha expirado.')

      case 'providerUnavailable':
        throw new ServiceUnavailableException('El proveedor de identidad no esta disponible.')
    }
  }
}
