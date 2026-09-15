import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'

import type { LoginOutcome, RefreshSessionOutcome } from '../../../application/dto/LoginResult'
import { CompleteSecondFactor } from '../../../application/use-cases/CompleteSecondFactor'
import { LoginAccount } from '../../../application/use-cases/LoginAccount'
import { LogoutAccount } from '../../../application/use-cases/LogoutAccount'
import { RefreshSession } from '../../../application/use-cases/RefreshSession'
import { CurrentIdentity, Public } from './auth/decorators'
import type { VerifiedIdentity } from '../../../application/ports/TokenVerifierPort'
import { SessionRevocationError } from '../../../application/ports/SessionRevocationPort'
import {
  CHOOSE_SECOND_FACTOR,
  COMPLETE_SECOND_FACTOR,
  COOKIE_SECURE,
  LOGIN_ACCOUNT,
  LOGOUT_ACCOUNT,
  REFRESH_SESSION,
} from './tokens'
import { ChooseSecondFactor } from '../../../application/use-cases/ChooseSecondFactor'
import {
  LoginRequest,
  ChooseSecondFactorRequest,
  SecondFactorRequest,
  SessionResponse,
} from './sessions.dto'

/**
 * Nombre y ruta de la cookie del testimonio de refresco (HU-02, sesion
 * persistente tras recargar). `Path` la acota a las rutas de sesion: el
 * navegador no la envia en `/api/accounts/*` ni en ningun otro origen de este
 * mismo servicio, que no la necesitan.
 */
const REFRESH_COOKIE_NAME = 'refresh_token'
const REFRESH_COOKIE_PATH = '/api/sessions'
/** 30 dias: vigencia por defecto del testimonio de refresco en este pool. */
const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Extrae una cookie del encabezado `Cookie` crudo.
 *
 * No se usa `cookie-parser`: es la unica cookie que este servicio lee en
 * cualquier ruta, y una dependencia nueva para un `split` no se justifica.
 */
const readCookie = (header: string | undefined, name: string): string | null => {
  if (header === undefined) {
    return null
  }

  for (const part of header.split(';')) {
    const separator = part.indexOf('=')

    if (separator <= 0) {
      continue
    }

    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim())
    }
  }

  return null
}

/**
 * Sesiones (HU-02, HU-03).
 *
 * Las rutas de login (`POST`, `POST second-factor*`) son publicas (`@Public()`):
 * pedirlas exigiria ya tener una sesion, lo cual es precisamente lo que todavia
 * no existe en ese punto.
 *
 * La ruta de logout (`DELETE`) exige una sesion activa autenticada: la identidad
 * se obtiene del testimonio verificado en el contexto de seguridad (HU-03).
 */
@ApiTags('sessions')
@Controller('sessions')
export class SessionsController {
  constructor(
    @Inject(LOGIN_ACCOUNT) private readonly loginAccount: LoginAccount,
    @Inject(COMPLETE_SECOND_FACTOR) private readonly completeSecondFactor: CompleteSecondFactor,
    @Inject(CHOOSE_SECOND_FACTOR) private readonly chooseSecondFactor: ChooseSecondFactor,
    @Inject(LOGOUT_ACCOUNT) private readonly logoutAccount: LogoutAccount,
    @Inject(REFRESH_SESSION) private readonly refreshSession: RefreshSession,
    @Inject(COOKIE_SECURE) private readonly cookieSecure: boolean,
  ) {}

  @ApiBearerAuth()
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cierra la sesion activa del usuario autenticado (HU-03)' })
  @ApiResponse({
    status: 204,
    description: 'Sesion cerrada y revocada exitosamente.',
  })
  @ApiResponse({ status: 401, description: 'No autenticado o token invalido' })
  @ApiResponse({ status: 503, description: 'El proveedor de identidad no esta disponible' })
  async logout(
    @CurrentIdentity() identity: VerifiedIdentity,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    // Se limpia la cookie AUNQUE la revocacion falle: quien pulsa "cerrar
    // sesion" debe perder el testimonio local de todos modos (mismo criterio
    // que `useSession.signOut` en Web: un 503 no debe dejar a nadie "adentro").
    response.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH })

    try {
      await this.logoutAccount.execute({ subject: identity.subject })
    } catch (error: unknown) {
      if (error instanceof SessionRevocationError) {
        throw new ServiceUnavailableException('El proveedor de identidad no esta disponible.')
      }
      throw error
    }
  }

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
  async login(
    @Body() body: LoginRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    const outcome = await this.loginAccount.execute({
      identifier: body.identifier,
      password: body.password,
    })

    if (outcome.kind === 'authenticated') {
      this.setRefreshCookie(response, outcome.refreshToken)
    }

    return SessionsController.translate(outcome)
  }

  /**
   * Renueva la sesion con el testimonio de refresco de la cookie, sin pedir
   * credenciales (HU-02, sesion persistente tras recargar la pagina).
   *
   * Publica como las demas rutas de esta primera etapa: exigir una sesion
   * para renovarla seria circular. La cookie -no un campo del cuerpo- es la
   * unica fuente del testimonio: un `HttpOnly` nunca llega a JavaScript, asi
   * que Web no podria enviarlo de otra forma aunque quisiera.
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renueva la sesion sin credenciales (HU-02)' })
  @ApiResponse({ status: 200, description: 'Sesion renovada.', type: SessionResponse })
  @ApiResponse({ status: 401, description: 'Sin sesion que renovar' })
  @ApiResponse({ status: 503, description: 'El proveedor de identidad no esta disponible' })
  async refresh(@Req() request: Request): Promise<SessionResponse> {
    const refreshToken = readCookie(request.headers.cookie, REFRESH_COOKIE_NAME)

    if (refreshToken === null) {
      throw new UnauthorizedException('No hay una sesion que renovar.')
    }

    const outcome = await this.refreshSession.execute(refreshToken)

    return SessionsController.translateRefresh(outcome)
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
  async secondFactor(
    @Body() body: SecondFactorRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    const outcome = await this.completeSecondFactor.execute({
      identifier: body.identifier,
      challengeToken: body.challengeToken,
      code: body.code,
    })

    if (outcome.kind === 'authenticated') {
      this.setRefreshCookie(response, outcome.refreshToken)
    }

    return SessionsController.translate(outcome)
  }

  /**
   * `HttpOnly` para que ningun script -legitimo o inyectado- pueda leerla;
   * `SameSite=Lax` basta para que el navegador SI la envie en el `POST /refresh`
   * que Web hace al cargar (navegacion propia, no de terceros) y NO la envie
   * si otro origen intentara disparar la misma ruta desde fuera. `Secure`
   * depende de `cookieSecure` (vease `COOKIE_SECURE` en `app.module.ts`).
   */
  private setRefreshCookie(response: Response, refreshToken: string): void {
    response.cookie(REFRESH_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
      maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    })
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

  private static translateRefresh(outcome: RefreshSessionOutcome): SessionResponse {
    switch (outcome.kind) {
      case 'refreshed':
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

      case 'invalid':
        throw new UnauthorizedException('No hay una sesion que renovar.')

      case 'providerUnavailable':
        throw new ServiceUnavailableException('El proveedor de identidad no esta disponible.')
    }
  }
}
