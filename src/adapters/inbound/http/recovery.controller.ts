import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'

import { DomainError } from '../../../domain/errors/DomainError'
import {
  RecoveryPasswordResetError,
  RecoveryRejectedError,
} from '../../../application/errors/RecoveryError'
import { StartPasswordRecovery } from '../../../application/use-cases/StartPasswordRecovery'
import { VerifyRecoveryAnswers } from '../../../application/use-cases/VerifyRecoveryAnswers'
import { VerifyRecoveryCode } from '../../../application/use-cases/VerifyRecoveryCode'
import { ResetRecoveryPassword } from '../../../application/use-cases/ResetRecoveryPassword'
import { Public } from './auth/decorators'
import {
  RESET_RECOVERY_PASSWORD,
  START_PASSWORD_RECOVERY,
  VERIFY_RECOVERY_ANSWERS,
  VERIFY_RECOVERY_CODE,
} from './tokens'
import {
  RecoveryChallengeResponse,
  RecoveryResetResponse,
  ResetRecoveryPasswordRequest,
  StartRecoveryRequest,
  StartRecoveryResponse,
  VerifyRecoveryAnswersRequest,
  VerifyRecoveryCodeRequest,
} from './accounts.dto'

@ApiTags('recovery')
@Controller('accounts/recovery')
export class RecoveryController {
  constructor(
    @Inject(START_PASSWORD_RECOVERY) private readonly startRecovery: StartPasswordRecovery,
    @Inject(VERIFY_RECOVERY_ANSWERS) private readonly verifyAnswers: VerifyRecoveryAnswers,
    @Inject(VERIFY_RECOVERY_CODE) private readonly verifyCode: VerifyRecoveryCode,
    @Inject(RESET_RECOVERY_PASSWORD) private readonly resetPassword: ResetRecoveryPassword,
  ) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Inicia la recuperacion de contrasena (HU-04, paso 1)' })
  async start(@Body() body: StartRecoveryRequest): Promise<StartRecoveryResponse> {
    try {
      return await this.startRecovery.execute(body.email)
    } catch (error: unknown) {
      throw RecoveryController.translate(error)
    }
  }

  @Public()
  @Post('answers')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Valida las preguntas de seguridad (HU-04, paso 2)' })
  async answers(@Body() body: VerifyRecoveryAnswersRequest): Promise<RecoveryChallengeResponse> {
    try {
      await this.verifyAnswers.execute(body.challengeToken, body.answers)

      return { challengeToken: body.challengeToken }
    } catch (error: unknown) {
      throw RecoveryController.translate(error)
    }
  }

  @Public()
  @Post('code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Valida el codigo de un solo uso (HU-04, paso 3)' })
  async code(@Body() body: VerifyRecoveryCodeRequest): Promise<RecoveryChallengeResponse> {
    try {
      await this.verifyCode.execute(body.challengeToken, body.code)

      return { challengeToken: body.challengeToken }
    } catch (error: unknown) {
      throw RecoveryController.translate(error)
    }
  }

  @Public()
  @Post('password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Establece la nueva contrasena (HU-04, paso 4)' })
  @ApiResponse({ status: 200, description: 'Contrasena actualizada' })
  async password(@Body() body: ResetRecoveryPasswordRequest): Promise<RecoveryResetResponse> {
    try {
      await this.resetPassword.execute(body.challengeToken, body.password)

      return { status: 'RESET' }
    } catch (error: unknown) {
      throw RecoveryController.translate(error)
    }
  }

  private static translate(error: unknown): Error {
    if (error instanceof RecoveryRejectedError || error instanceof DomainError) {
      return new BadRequestException(error.message)
    }

    if (error instanceof RecoveryPasswordResetError) {
      return new ServiceUnavailableException(
        'El proveedor de identidad no esta disponible. Intentelo de nuevo mas tarde.',
      )
    }

    return error instanceof Error ? error : new Error('Fallo desconocido del servicio.')
  }
}
