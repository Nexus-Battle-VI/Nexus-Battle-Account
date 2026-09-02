import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import type { Reflector } from '@nestjs/core'

import type { ClockPort } from '../../../../application/ports/ClockPort'
import type { Logger } from '../../../../infrastructure/observability/logger'
import { IS_INTERNAL } from './decorators'
import {
  INTERNAL_CLOCK_SKEW_MS,
  INTERNAL_SERVICE_HEADER,
  INTERNAL_SIGNATURE_HEADER,
  INTERNAL_TIMESTAMP_HEADER,
  signInternalRequest,
  signatureMatches,
  timestampWithinWindow,
} from './internal-signature'

interface InternalRequest {
  readonly method?: string
  readonly originalUrl?: string
  readonly url?: string
  readonly headers: Record<string, string | string[] | undefined>
  readonly body?: unknown
}

export interface InternalServiceGuardOptions {
  readonly reflector: Reflector
  readonly secret: string | null
  readonly allowedServices: readonly string[]
  readonly clock: ClockPort
  readonly logger: Logger
  readonly skewMs?: number
}

/**
 * Guard del contrato interno entre servicios.
 *
 * Se registra de forma GLOBAL y solo actua sobre rutas marcadas con
 * `@InternalOnly()`; el resto las deja pasar sin tocarlas.
 *
 * Protege rutas que NO son para personas: quien llama es otro servicio del
 * sistema, y lo demuestra firmando la peticion con un secreto compartido. Sin
 * esto, un usuario cualquiera podria consultar el endpoint interno haciendose
 * pasar por Catalog.
 *
 * NO REVELA POR QUE FALLA. Distinguir «servicio no permitido» de «firma
 * incorrecta» o de «sello caducado» le diria a quien esta probando exactamente
 * que le falta. Todas las rutas de rechazo responden lo mismo.
 *
 * SIN SECRETO CONFIGURADO, NIEGA. La alternativa -dejar pasar cuando falta la
 * configuracion- convertiria un despliegue incompleto en un endpoint interno
 * abierto, y ese fallo no se manifestaria hasta que alguien lo aprovechara. Se
 * responde 503, no 401: el servicio no puede comprobar la peticion, y culpar a
 * quien llama seria mentir sobre la causa.
 */
@Injectable()
export class InternalServiceGuard implements CanActivate {
  private readonly options: InternalServiceGuardOptions

  constructor(options: InternalServiceGuardOptions) {
    this.options = options
  }

  canActivate(context: ExecutionContext): boolean {
    // Guard GLOBAL que solo actua sobre rutas marcadas. Se registra junto a los
    // demas -y antes que ellos- en lugar de colgarse del controlador con
    // `@UseGuards`, porque asi sigue el mismo patron que el resto de la capa de
    // autenticacion de este servicio: metadatos en la ruta, decision en el guard.
    const esInterna = this.options.reflector.getAllAndOverride<boolean>(IS_INTERNAL, [
      context.getHandler(),
      context.getClass(),
    ])

    if (!esInterna) {
      return true
    }

    const request = context.switchToHttp().getRequest<InternalRequest>()

    if (this.options.secret === null || this.options.secret.length === 0) {
      this.options.logger.error('internal_auth_sin_secreto', {
        detail: 'INTERNAL_SERVICE_AUTH_SECRET no esta configurado: el contrato interno niega.',
      })

      throw new ServiceUnavailableException('El contrato interno no esta disponible.')
    }

    const service = header(request, INTERNAL_SERVICE_HEADER)
    const timestamp = header(request, INTERNAL_TIMESTAMP_HEADER)
    const signature = header(request, INTERNAL_SIGNATURE_HEADER)

    if (service === undefined || timestamp === undefined || signature === undefined) {
      return this.reject('cabeceras_incompletas')
    }

    if (!this.options.allowedServices.includes(service)) {
      return this.reject('servicio_no_permitido')
    }

    if (
      !timestampWithinWindow(
        timestamp,
        this.options.clock.now(),
        this.options.skewMs ?? INTERNAL_CLOCK_SKEW_MS,
      )
    ) {
      return this.reject('sello_fuera_de_ventana')
    }

    // La ruta se toma de la peticion, sin la cadena de consulta: es la misma
    // que firma quien llama, y una diferencia aqui invalidaria toda firma sin
    // que el motivo fuera visible en ninguna parte.
    const path = (request.originalUrl ?? request.url ?? '').split('?')[0] ?? ''

    const expected = signInternalRequest(this.options.secret, {
      service,
      method: request.method ?? 'POST',
      path,
      timestamp,
      body: request.body ?? {},
    })

    if (!signatureMatches(expected, signature)) {
      return this.reject('firma_invalida')
    }

    this.options.logger.info('internal_auth_aceptada', { service })

    return true
  }

  /**
   * El motivo se registra pero NO se devuelve. Sirve para diagnosticar desde
   * dentro sin darle pistas a quien prueba desde fuera.
   */
  private reject(reason: string): never {
    this.options.logger.warn('internal_auth_rechazada', { reason })

    throw new UnauthorizedException('Peticion interna no autorizada.')
  }
}

const header = (request: InternalRequest, name: string): string | undefined => {
  const value = request.headers[name]

  return Array.isArray(value) ? value[0] : value
}
