import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'

import { SubmitAppeal } from '../../../application/use-cases/SubmitAppeal'
import { GetMyAppealStatus } from '../../../application/use-cases/GetMyAppealStatus'
import { GetAppealableSanctions } from '../../../application/use-cases/GetAppealableSanctions'
import {
  AccountNotFoundError,
  SanctionNotFoundError,
} from '../../../application/errors/ApplicationError'
import { DomainError } from '../../../domain/errors/DomainError'
import { Public } from './auth/decorators'
import { AppealAccessGuard, CurrentAppealAccess } from './auth/appeal-access.guard'
import type { AppealAccessTokenPayload } from '../../../application/ports/AppealAccessTokenPort'
import { GET_APPEALABLE_SANCTIONS, GET_MY_APPEAL_STATUS, SUBMIT_APPEAL } from './tokens'
import { AppealResponse, SubmitAppealRequest } from './appeals.dto'
import { SanctionResponse } from './sanctions.dto'

/**
 * Autoservicio de apelaciones del propio titular (HU-42, §6). Protegido por
 * `AppealAccessGuard`, no por `JwtAuthGuard`: por eso la clase es `@Public()`
 * -para que el guard global no intervenga- y usa `@UseGuards` explicito con
 * el guard de apelacion.
 */
@ApiTags('appeals')
@ApiBearerAuth()
@Public()
@UseGuards(AppealAccessGuard)
@Controller('accounts/me/appeals')
export class MyAppealsController {
  constructor(
    @Inject(SUBMIT_APPEAL) private readonly submitAppeal: SubmitAppeal,
    @Inject(GET_MY_APPEAL_STATUS) private readonly getMyAppealStatus: GetMyAppealStatus,
    @Inject(GET_APPEALABLE_SANCTIONS)
    private readonly getAppealableSanctions: GetAppealableSanctions,
  ) {}

  @Get('sanctions')
  @ApiOperation({
    summary:
      'Sanciones de la propia cuenta que todavia pueden apelarse (dentro de 30 dias, sin apelacion previa)',
  })
  @ApiResponse({ status: 200, type: [SanctionResponse] })
  async appealableSanctions(
    @CurrentAppealAccess() access: AppealAccessTokenPayload,
  ): Promise<readonly SanctionResponse[]> {
    const sanctions = await this.getAppealableSanctions.execute(access.accountId)

    return sanctions.map((sanction) => sanction.toSnapshot())
  }

  @Post()
  @ApiOperation({ summary: 'Presenta una apelacion sobre una sancion propia' })
  @ApiResponse({ status: 201, type: AppealResponse })
  async submit(
    @CurrentAppealAccess() access: AppealAccessTokenPayload,
    @Body() body: SubmitAppealRequest,
  ): Promise<AppealResponse> {
    try {
      const appeal = await this.submitAppeal.execute({
        accountId: access.accountId,
        sanctionId: body.sanctionId,
        statement: body.statement,
      })

      return appeal.toSnapshot()
    } catch (error: unknown) {
      if (error instanceof SanctionNotFoundError || error instanceof AccountNotFoundError) {
        throw new NotFoundException(error.message)
      }

      if (error instanceof DomainError) {
        if (error.message.includes('Solo el titular')) {
          throw new ForbiddenException(error.message)
        }

        throw new BadRequestException(error.message)
      }

      throw error
    }
  }

  @Get()
  @ApiOperation({ summary: 'Consulta el estado de las apelaciones propias' })
  @ApiResponse({ status: 200, type: [AppealResponse] })
  async myAppeals(
    @CurrentAppealAccess() access: AppealAccessTokenPayload,
  ): Promise<readonly AppealResponse[]> {
    const appeals = await this.getMyAppealStatus.execute(access.accountId)

    return appeals.map((appeal) => appeal.toSnapshot())
  }
}
