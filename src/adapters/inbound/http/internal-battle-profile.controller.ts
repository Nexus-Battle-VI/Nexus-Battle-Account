import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
} from '@nestjs/common'
import { ApiExcludeController, ApiOperation, ApiProperty, ApiResponse } from '@nestjs/swagger'

import type { GetOwnAccount } from '../../../application/use-cases/GetOwnAccount'
import { AccountNotFoundError } from '../../../application/errors/ApplicationError'
import { InternalOnly, Public } from './auth/decorators'
import { GET_OWN_ACCOUNT } from './tokens'

export class BattleProfileResponse {
  @ApiProperty({ description: 'Sujeto (`sub`) del proveedor de identidad.' })
  readonly subject!: string

  @ApiProperty({ example: 'Ana Ramirez', description: 'Apodo visible de la cuenta.' })
  readonly displayName!: string

  @ApiProperty({
    type: String,
    nullable: true,
    example: '/accounts/0b1d5b0e-3f6a-4a1e-9a1a-4a5c6f2b8e10/avatar',
    description: 'Ruta que sirve el avatar real; null si la cuenta no tiene uno recuperable.',
  })
  readonly avatarUrl!: string | null
}

/**
 * Contrato INTERNO entre servicios (HU-15/RF-15, DP-2).
 *
 * Lo consume Combat para resolver el "perfil de batalla" de un jugador
 * (`identity.subject`) sin duplicar el acceso a la base de datos de Account
 * ni reutilizar el endpoint de moderacion `GET /accounts/:id/display-name`
 * -ese es MODERATOR-only y esta pensado para identificar autores reportados,
 * no para que otro servicio resuelva un perfil en cada peticion-.
 *
 * Mismo patron que `InternalMfaEvidenceController`: `@Public()` excluye la
 * ruta del guard de testimonios de usuario -quien llama es un servicio, no
 * trae JWT de jugador-, y `@InternalOnly()` la somete a
 * `InternalServiceGuard`, que exige firma HMAC valida. `@ApiExcludeController`
 * la mantiene fuera de la documentacion publica.
 *
 * LA RESPUESTA ES DELIBERADAMENTE MINIMA: `subject`, `displayName` y
 * `avatarUrl`. Nunca correo, roles, pais ni nombre legal -Combat no necesita
 * esos datos para dejar entrar a alguien a una sala, y devolverlos
 * extenderia la superficie de un contrato que otro equipo no controla-.
 */
@ApiExcludeController()
@Controller('internal/accounts')
export class InternalBattleProfileController {
  constructor(@Inject(GET_OWN_ACCOUNT) private readonly getOwnAccount: GetOwnAccount) {}

  @Public()
  @InternalOnly()
  @Get(':subject/battle-profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recupera el perfil minimo de batalla de un jugador (interno)' })
  @ApiResponse({ status: 200, description: 'Perfil de batalla', type: BattleProfileResponse })
  @ApiResponse({ status: 401, description: 'Peticion interna no autorizada' })
  @ApiResponse({ status: 404, description: 'El sujeto no tiene cuenta en este servicio' })
  @ApiResponse({ status: 503, description: 'El contrato interno no esta configurado' })
  async battleProfile(@Param('subject') subject: string): Promise<BattleProfileResponse> {
    try {
      const account = await this.getOwnAccount.execute(subject)

      return {
        subject,
        displayName: account.displayName,
        avatarUrl: account.avatarUrl,
      }
    } catch (error: unknown) {
      if (error instanceof AccountNotFoundError) {
        throw new NotFoundException(error.message)
      }

      throw error
    }
  }
}
