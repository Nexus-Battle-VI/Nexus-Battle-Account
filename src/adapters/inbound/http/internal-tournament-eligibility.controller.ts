import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { ApiExcludeController } from '@nestjs/swagger'
import { IsNotEmpty, IsString } from 'class-validator'

import { AccountNotFoundError } from '../../../application/errors/ApplicationError'
import { TournamentIdentityError } from '../../../application/errors/TournamentIdentityError'
import type {
  GetTournamentEligibility,
  TournamentEligibility,
} from '../../../application/use-cases/GetTournamentEligibility'
import type {
  TournamentTeamIdentity,
  ValidateTournamentTeamIdentity,
} from '../../../application/use-cases/ValidateTournamentTeamIdentity'
import { InternalOnly, Public } from './auth/decorators'
import { GET_TOURNAMENT_ELIGIBILITY, VALIDATE_TOURNAMENT_TEAM_IDENTITY } from './tokens'

export class ValidateTournamentTeamIdentityRequest {
  @IsString()
  readonly name!: string

  @IsString()
  @IsNotEmpty()
  readonly avatarSubject!: string
}

/** Solo HMAC de Tournament; Public excluye JWT, no la guarda interna global. */
@ApiExcludeController()
@Controller('internal/accounts')
@Public()
@InternalOnly('tournament')
export class InternalTournamentEligibilityController {
  constructor(
    @Inject(GET_TOURNAMENT_ELIGIBILITY) private readonly eligibility: GetTournamentEligibility,
    @Inject(VALIDATE_TOURNAMENT_TEAM_IDENTITY)
    private readonly identity: ValidateTournamentTeamIdentity,
  ) {}

  @Get(':subject/tournament-eligibility')
  async get(@Param('subject') subject: string): Promise<TournamentEligibility> {
    try {
      return await this.eligibility.execute(subject)
    } catch (error: unknown) {
      return throwHttpError(error)
    }
  }

  @Post('tournament-team-identity/validation')
  @HttpCode(HttpStatus.OK)
  async validate(
    @Body() body: ValidateTournamentTeamIdentityRequest,
  ): Promise<TournamentTeamIdentity> {
    try {
      return await this.identity.execute(body.name, body.avatarSubject)
    } catch (error: unknown) {
      return throwHttpError(error)
    }
  }
}

const throwHttpError = (error: unknown): never => {
  if (error instanceof AccountNotFoundError) {
    throw new NotFoundException('La cuenta no existe.')
  }
  if (error instanceof TournamentIdentityError) {
    throw new UnprocessableEntityException({ code: error.code, message: error.message })
  }

  // No se devuelve el error del proveedor, perfiles, claves ni rutas locales.
  throw new ServiceUnavailableException('La consulta interna de Account no esta disponible.')
}
