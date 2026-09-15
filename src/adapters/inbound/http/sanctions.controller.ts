import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'

import { ApplySanction } from '../../../application/use-cases/ApplySanction'
import { AccountNotFoundError } from '../../../application/errors/ApplicationError'
import { DomainError } from '../../../domain/errors/DomainError'
import { Role } from '../../../domain/entities/Role'
import { CurrentIdentity, Roles } from './auth/decorators'
import type { VerifiedIdentity } from '../../../application/ports/TokenVerifierPort'
import { APPLY_SANCTION } from './tokens'
import { ApplySanctionRequest, SanctionResponse } from './sanctions.dto'

@ApiTags('sanctions')
@ApiBearerAuth()
@Controller('accounts/:id/sanctions')
export class SanctionsController {
  constructor(
    @Inject(APPLY_SANCTION)
    private readonly applySanction: ApplySanction,
  ) {}

  @Roles(Role.Moderator, Role.Administrator, Role.SuperAdministrator)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Registra una sancion progresiva sobre una cuenta (HU-42.1)',
  })
  @ApiResponse({
    status: 201,
    description: 'Sancion registrada correctamente',
    type: SanctionResponse,
  })
  @ApiResponse({
    status: 400,
    description: 'Datos de sancion invalidos',
  })
  @ApiResponse({
    status: 403,
    description: 'El actor no puede aplicar ese tipo de sancion',
  })
  @ApiResponse({
    status: 404,
    description: 'La cuenta objetivo no existe',
  })
  async apply(
    @CurrentIdentity() identity: VerifiedIdentity,
    @Param('id') targetAccountId: string,
    @Body() body: ApplySanctionRequest,
  ): Promise<SanctionResponse> {
    try {
      const sanction = await this.applySanction.execute({
        actorSubject: identity.subject,
        targetAccountId,
        type: body.type,
        reason: body.reason,
        suspensionDurationMinutes: body.suspensionDurationMinutes,
      })

      return sanction.toSnapshot()
    } catch (error: unknown) {
      if (error instanceof AccountNotFoundError) {
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
