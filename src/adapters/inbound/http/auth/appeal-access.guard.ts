import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common'

import {
  APPEAL_ACCESS_TOKEN,
  type AppealAccessTokenPayload,
  type AppealAccessTokenPort,
} from '../../../../application/ports/AppealAccessTokenPort'

export interface RequestWithAppealAccess {
  appealAccess?: AppealAccessTokenPayload
  headers: Record<string, string | string[] | undefined>
}

/**
 * Protege las rutas de autoservicio de apelaciones (HU-42, §6: "identidad
 * restringida"), NUNCA las rutas generales: se usa con `@UseGuards(...)`
 * directamente en `MyAppealsController`, no de forma global como
 * `JwtAuthGuard`.
 *
 * Verifica un token emitido por `AuthenticateForAppeal`, NO un testimonio de
 * Cognito: por eso las rutas que protege se marcan tambien `@Public()`, para
 * que `JwtAuthGuard` no intente -y falle- verificarlo como JWT de Cognito.
 */
@Injectable()
export class AppealAccessGuard implements CanActivate {
  constructor(@Inject(APPEAL_ACCESS_TOKEN) private readonly tokens: AppealAccessTokenPort) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithAppealAccess>()
    const token = AppealAccessGuard.readBearerToken(request.headers.authorization)

    if (token === null) {
      throw new UnauthorizedException('Falta el token de apelacion.')
    }

    const payload = this.tokens.verify(token)

    if (payload === null) {
      throw new UnauthorizedException('El token de apelacion no es valido o esta vencido.')
    }

    request.appealAccess = payload

    return true
  }

  private static readBearerToken(header: string | string[] | undefined): string | null {
    if (typeof header !== 'string') {
      return null
    }

    const parts = header.split(' ')

    if (parts.length !== 2) {
      return null
    }

    const [scheme, value] = parts

    if (scheme?.toLowerCase() !== 'bearer' || value === undefined || value.length === 0) {
      return null
    }

    return value
  }
}

export const currentAppealAccessOf = (context: ExecutionContext): AppealAccessTokenPayload => {
  const { appealAccess } = context.switchToHttp().getRequest<RequestWithAppealAccess>()

  if (appealAccess === undefined) {
    throw new UnauthorizedException('La peticion no llego con un token de apelacion verificado.')
  }

  return appealAccess
}

export const CurrentAppealAccess = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AppealAccessTokenPayload =>
    currentAppealAccessOf(context),
)
