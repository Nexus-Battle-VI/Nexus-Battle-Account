import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { memoryStorage } from 'multer'

import { DomainError } from '../../../domain/errors/DomainError'
import { AVATAR_MAX_BYTES } from '../../../domain/value-objects/AvatarMetadata'
import {
  AccountAlreadyExistsError,
  AccountNotFoundError,
  DisplayNameAlreadyTakenError,
  IdentityAlreadyRegisteredError,
  IdentityRequiredError,
  NicknameBlacklistedError,
} from '../../../application/errors/ApplicationError'
import { RoleDirectoryError } from '../../../application/ports/RoleDirectoryPort'
import { VerifiedEmailDirectoryError } from '../../../application/ports/VerifiedEmailDirectoryPort'
import type { RegisterSecurityAnswer } from '../../../application/dto/RegisterAccountCommand'
import { RegisterAccount } from '../../../application/use-cases/RegisterAccount'
import { GetAccount } from '../../../application/use-cases/GetAccount'
import { GetOwnAccount } from '../../../application/use-cases/GetOwnAccount'
import { VerifyAccount } from '../../../application/use-cases/VerifyAccount'
import { Role } from '../../../domain/entities/Role'
import { CurrentIdentity, Roles } from './auth/decorators'
import type { VerifiedIdentity } from '../../../application/ports/TokenVerifierPort'
import { REGISTER_ACCOUNT, GET_ACCOUNT, GET_OWN_ACCOUNT, VERIFY_ACCOUNT } from './tokens'
import { AccountResponse, RegisterAccountRequest } from './accounts.dto'

interface UploadedAvatar {
  readonly mimetype: string
  readonly originalname: string
  readonly size: number
  readonly buffer: Buffer
}

@ApiTags('accounts')
@ApiBearerAuth()
@Controller('accounts')
export class AccountsController {
  constructor(
    @Inject(REGISTER_ACCOUNT) private readonly registerAccount: RegisterAccount,
    @Inject(GET_ACCOUNT) private readonly getAccount: GetAccount,
    @Inject(GET_OWN_ACCOUNT) private readonly getOwnAccount: GetOwnAccount,
    @Inject(VERIFY_ACCOUNT) private readonly verifyAccount: VerifyAccount,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: memoryStorage(),
      limits: { fileSize: AVATAR_MAX_BYTES },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Registra una cuenta de jugador (HU-01)' })
  @ApiResponse({ status: 201, description: 'Cuenta registrada', type: AccountResponse })
  @ApiResponse({ status: 400, description: 'Datos invalidos' })
  @ApiResponse({ status: 401, description: 'Falta el testimonio o no es valido' })
  @ApiResponse({ status: 409, description: 'El correo o el apodo ya estan registrados' })
  @ApiResponse({
    status: 503,
    description:
      'El proveedor de identidad no respondio. La cuenta NO se creo: no se pudo comprobar el correo o reflejar el rol.',
  })
  async register(
    @Body() body: RegisterAccountRequest,
    @UploadedFile() avatar: UploadedAvatar | undefined,
    @CurrentIdentity() identity: VerifiedIdentity,
  ): Promise<AccountResponse> {
    try {
      // El sujeto se pasa TAL CUAL, tambien cuando es `anonymous`.
      //
      // Antes se convertia a `undefined` para que el caso de uso creara una
      // identidad. Ya no crea ninguna: la identidad existe antes que la cuenta.
      // Con `AUTH_MODE=disabled` el sujeto queda literalmente `anonymous`, que
      // es lo que ADR-004 describe: los datos dicen que nadie fue verificado en
      // vez de aparentar personas concretas.
      const subject = identity.subject

      return await this.registerAccount.execute({
        email: body.email,
        password: body.password,
        displayName: body.nickname,
        firstNames: body.firstNames,
        lastNames: body.lastNames,
        termsAccepted: body.termsAccepted,
        securityAnswers: parseSecurityAnswers(body.securityAnswers),
        ...(avatar === undefined
          ? {}
          : {
              avatar: {
                mimeType: avatar.mimetype,
                originalName: avatar.originalname,
                sizeBytes: avatar.size,
                bytes: avatar.buffer,
              },
            }),
        subject,
      })
    } catch (error: unknown) {
      throw AccountsController.translate(error)
    }
  }

  @Get('me')
  @ApiOperation({ summary: 'Recupera la cuenta asociada al testimonio' })
  @ApiResponse({ status: 200, description: 'Cuenta encontrada', type: AccountResponse })
  @ApiResponse({ status: 401, description: 'Falta el testimonio o no es valido' })
  @ApiResponse({ status: 404, description: 'El sujeto no tiene cuenta en este servicio' })
  async findOwn(@CurrentIdentity() identity: VerifiedIdentity): Promise<AccountResponse> {
    try {
      return await this.getOwnAccount.execute(identity.subject)
    } catch (error: unknown) {
      throw AccountsController.translate(error)
    }
  }

  @Roles(Role.Administrator)
  @Get(':id')
  @ApiOperation({ summary: 'Recupera una cuenta por su identificador. Requiere ADMINISTRATOR' })
  @ApiResponse({ status: 200, description: 'Cuenta encontrada', type: AccountResponse })
  @ApiResponse({ status: 401, description: 'Falta el testimonio o no es valido' })
  @ApiResponse({ status: 403, description: 'La identidad no es administradora' })
  @ApiResponse({ status: 404, description: 'La cuenta no existe' })
  async findOne(@Param('id') id: string): Promise<AccountResponse> {
    try {
      return await this.getAccount.execute(id)
    } catch (error: unknown) {
      throw AccountsController.translate(error)
    }
  }

  @Roles(Role.Administrator)
  @Post(':id/verification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Marca la cuenta como verificada. Requiere rol ADMINISTRATOR' })
  @ApiResponse({ status: 200, description: 'Cuenta verificada', type: AccountResponse })
  @ApiResponse({ status: 400, description: 'La cuenta no admite verificacion' })
  @ApiResponse({ status: 401, description: 'Falta el testimonio o no es valido' })
  @ApiResponse({ status: 403, description: 'La identidad no es administradora' })
  @ApiResponse({ status: 404, description: 'La cuenta no existe' })
  async verify(@Param('id') id: string): Promise<AccountResponse> {
    try {
      return await this.verifyAccount.execute(id)
    } catch (error: unknown) {
      throw AccountsController.translate(error)
    }
  }

  private static translate(error: unknown): Error {
    if (
      error instanceof AccountAlreadyExistsError ||
      error instanceof DisplayNameAlreadyTakenError ||
      error instanceof IdentityAlreadyRegisteredError
    ) {
      return new ConflictException(error.message)
    }

    if (error instanceof NicknameBlacklistedError) {
      return new BadRequestException(error.message)
    }

    if (error instanceof AccountNotFoundError) {
      return new NotFoundException(error.message)
    }

    /**
     * El testimonio es valido pero no identifica a nadie.
     *
     * El verificador ya rechaza un `sub` ausente o vacio, asi que esto solo se
     * alcanza con un `sub` de puros espacios: valido para el verificador,
     * inservible como identidad. Es un fallo de autenticacion y debe decirlo;
     * como 500 acusaria al servicio de un defecto que no tiene.
     */
    if (error instanceof IdentityRequiredError) {
      return new UnauthorizedException(error.message)
    }

    /**
     * El proveedor de identidad no respondio.
     *
     * NO es 500. Un 500 dice "este servicio tiene un defecto" y ademas no
     * sugiere reintentar; esto es lo contrario en ambas cosas: el servicio
     * funciona, la dependencia no, y el intento tiene sentido mas tarde. El
     * registro **falla cerrado** a proposito -no se guarda una cuenta cuyo rol
     * no viajaria en el testimonio- y quien llama merece saber por que.
     */
    if (error instanceof RoleDirectoryError || error instanceof VerifiedEmailDirectoryError) {
      return new ServiceUnavailableException(
        'El proveedor de identidad no esta disponible. Intentelo de nuevo mas tarde.',
      )
    }

    if (error instanceof DomainError) {
      return new BadRequestException(error.message)
    }

    return error instanceof Error ? error : new Error('Fallo desconocido del servicio.')
  }
}

const parseSecurityAnswers = (raw: string): RegisterSecurityAnswer[] => {
  let parsed: unknown

  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    throw new BadRequestException('Las respuestas de seguridad deben ser un JSON valido.')
  }

  if (!Array.isArray(parsed)) {
    throw new BadRequestException('Las respuestas de seguridad deben ser una lista.')
  }

  return parsed.map((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new BadRequestException('Cada respuesta de seguridad es invalida.')
    }

    const record = entry as { questionId?: unknown; answer?: unknown }

    if (typeof record.questionId !== 'string' || typeof record.answer !== 'string') {
      throw new BadRequestException('Cada respuesta debe incluir questionId y answer.')
    }

    return { questionId: record.questionId, answer: record.answer }
  })
}
