import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'

import { ListAppealsForReview } from '../../../application/use-cases/ListAppealsForReview'
import { ResolveAppeal } from '../../../application/use-cases/ResolveAppeal'
import {
  AccountNotFoundError,
  AppealNotFoundError,
  SanctionNotFoundError,
} from '../../../application/errors/ApplicationError'
import { DomainError } from '../../../domain/errors/DomainError'
import { Role } from '../../../domain/entities/Role'
import { CurrentIdentity, Roles } from './auth/decorators'
import type { VerifiedIdentity } from '../../../application/ports/TokenVerifierPort'
import { LIST_APPEALS_FOR_REVIEW, RESOLVE_APPEAL } from './tokens'
import { AppealResponse, ResolveAppealRequest } from './appeals.dto'

/**
 * Panel de revision de apelaciones (HU-42, §7.3.2: "revision por parte de un
 * panel de moderadores/administradores"). La autoridad real para resolver
 * -puede un Moderador decidir sobre un baneo- la comprueba `ResolveAppeal`
 * reutilizando `SanctionPolicy`; el `@Roles` de aqui solo exige el piso
 * minimo (ningun Jugador llega siquiera al caso de uso).
 */
@ApiTags('appeals')
@ApiBearerAuth()
@Controller('accounts/appeals')
export class ReviewAppealsController {
  constructor(
    @Inject(LIST_APPEALS_FOR_REVIEW) private readonly listAppealsForReview: ListAppealsForReview,
    @Inject(RESOLVE_APPEAL) private readonly resolveAppeal: ResolveAppeal,
  ) {}

  @Roles(Role.Moderator, Role.Administrator, Role.SuperAdministrator)
  @Get()
  @ApiOperation({ summary: 'Lista las apelaciones pendientes de decision' })
  @ApiResponse({ status: 200, type: [AppealResponse] })
  async pending(): Promise<readonly AppealResponse[]> {
    const appeals = await this.listAppealsForReview.execute()

    return appeals.map((appeal) => appeal.toSnapshot())
  }

  @Roles(Role.Moderator, Role.Administrator, Role.SuperAdministrator)
  @Post(':id/resolution')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Registra la decision final de una apelacion' })
  @ApiResponse({ status: 200, type: AppealResponse })
  @ApiResponse({ status: 403, description: 'El actor no tiene autoridad sobre esta sancion' })
  @ApiResponse({ status: 404, description: 'La apelacion no existe' })
  async resolve(
    @CurrentIdentity() identity: VerifiedIdentity,
    @Param('id') appealId: string,
    @Body() body: ResolveAppealRequest,
  ): Promise<AppealResponse> {
    try {
      const appeal = await this.resolveAppeal.execute({
        actorSubject: identity.subject,
        appealId,
        decision: body.decision,
        notes: body.notes,
      })

      return appeal.toSnapshot()
    } catch (error: unknown) {
      if (
        error instanceof AppealNotFoundError ||
        error instanceof SanctionNotFoundError ||
        error instanceof AccountNotFoundError
      ) {
        throw new NotFoundException(error.message)
      }

      if (error instanceof DomainError) {
        if (error.message.includes('permisos')) {
          throw new ForbiddenException(error.message)
        }

        throw new BadRequestException(error.message)
      }

      throw error
    }
  }
}
