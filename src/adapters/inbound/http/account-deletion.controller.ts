import {
  BadRequestException,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'

import { DomainError } from '../../../domain/errors/DomainError'
import {
  AccountAlreadyDeletedError,
  AccountNotFoundError,
} from '../../../application/errors/ApplicationError'
import { RequestAccountDeletion } from '../../../application/use-cases/RequestAccountDeletion'
import { CurrentIdentity } from './auth/decorators'
import type { VerifiedIdentity } from '../../../application/ports/TokenVerifierPort'
import { REQUEST_ACCOUNT_DELETION } from './tokens'
import { AccountDeletionRequestResponse } from './accounts.dto'

/**
 * Solicitud de eliminacion de la cuenta propia (HU-43.2).
 *
 * NO elimina la cuenta, NO trata datos personales y NO representa el cierre
 * de HU-43: unicamente registra, de forma durable, que el titular lo pidio
 * (HU-43.1, Management #303) y confirma su RECEPCION. El alcance de HU-43
 * -Account trata sus propios datos, sin coordinar Community, Commerce,
 * Player/Inventory ni Catalog- ya esta fijado en EN-011 y ADR-014 Decision 5.
 *
 * Nace PROTEGIDA -el guard es global- y no lleva `@Roles`: cualquier
 * identidad autenticada solicita la eliminacion de SU PROPIA cuenta, igual
 * que `PATCH accounts/me` y `POST accounts/me/password`. No acepta ningun
 * identificador de cuenta en el cuerpo: la unica autoridad es el sujeto del
 * testimonio ya verificado.
 *
 * `200 OK`, no `201 Created`: sigue el mismo patron que el resto de comandos
 * de este controlador sobre la cuenta propia ya existente (confirmar
 * registro, verificar cuenta, asignar/retirar rol) -201 en este servicio se
 * reserva para el alta de una Account nueva (`POST /accounts`). Ademas, la
 * respuesta es idempotente por diseño: una repeticion mientras la solicitud
 * sigue activa devuelve la MISMA solicitud, no crea un recurso nuevo cada
 * vez, lo que encajaria mal con la semantica de `201 Created`.
 */
@ApiTags('accounts')
@ApiBearerAuth()
@Controller('accounts/me')
export class AccountDeletionController {
  constructor(
    @Inject(REQUEST_ACCOUNT_DELETION)
    private readonly requestAccountDeletion: RequestAccountDeletion,
  ) {}

  @Post('deletion-requests')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Solicita la eliminacion de la cuenta propia (HU-43.2)',
    description:
      'Confirma unicamente RECEPCION. No elimina la cuenta ni trata datos personales todavia.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Solicitud recibida (o ya activa: la respuesta es idempotente y no crea un segundo proceso).',
    type: AccountDeletionRequestResponse,
  })
  @ApiResponse({ status: 401, description: 'Falta el testimonio o no es valido' })
  @ApiResponse({ status: 404, description: 'El sujeto no tiene cuenta en este servicio' })
  @ApiResponse({ status: 409, description: 'La cuenta ya fue eliminada (HU-43.3)' })
  async requestDeletion(
    @CurrentIdentity() identity: VerifiedIdentity,
  ): Promise<AccountDeletionRequestResponse> {
    try {
      return await this.requestAccountDeletion.execute(identity.subject)
    } catch (error: unknown) {
      throw AccountDeletionController.translate(error)
    }
  }

  private static translate(error: unknown): Error {
    if (error instanceof AccountNotFoundError) {
      return new NotFoundException(error.message)
    }

    if (error instanceof AccountAlreadyDeletedError) {
      return new ConflictException(error.message)
    }

    if (error instanceof DomainError) {
      return new BadRequestException(error.message)
    }

    return error instanceof Error ? error : new Error('Fallo desconocido del servicio.')
  }
}
