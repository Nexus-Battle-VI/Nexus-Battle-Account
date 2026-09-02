import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
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
import { MfaStatusError } from '../../../application/ports/MfaStatusPort'
import { SessionRevocationError } from '../../../application/ports/SessionRevocationPort'
import { IdentitySignUpError } from '../../../application/ports/IdentitySignUpPort'
import type { RegisterSecurityAnswer } from '../../../application/dto/RegisterAccountCommand'
import { RegisterAccount } from '../../../application/use-cases/RegisterAccount'
import { ConfirmRegistration } from '../../../application/use-cases/ConfirmRegistration'
import { GetAccount } from '../../../application/use-cases/GetAccount'
import { GetOwnAccount } from '../../../application/use-cases/GetOwnAccount'
import { UpdateOwnAccount } from '../../../application/use-cases/UpdateOwnAccount'
import { VerifyAccount } from '../../../application/use-cases/VerifyAccount'
import { AssignRole } from '../../../application/use-cases/AssignRole'
import { FindAccountByEmail } from '../../../application/use-cases/FindAccountByEmail'
import { RevokeRole } from '../../../application/use-cases/RevokeRole'
import { Role, isRole } from '../../../domain/entities/Role'
import { CurrentIdentity, Public, Roles } from './auth/decorators'
import type { VerifiedIdentity } from '../../../application/ports/TokenVerifierPort'
import {
  REGISTER_ACCOUNT,
  GET_ACCOUNT,
  GET_OWN_ACCOUNT,
  UPDATE_OWN_ACCOUNT,
  VERIFY_ACCOUNT,
  CONFIRM_REGISTRATION,
  FIND_ACCOUNT_BY_EMAIL,
  ASSIGN_ROLE,
  REVOKE_ROLE,
} from './tokens'
import {
  AccountResponse,
  AssignRoleRequest,
  ConfirmRegistrationRequest,
  FindAccountByEmailQuery,
  ManagedAccountResponse,
  RegisterAccountRequest,
  UpdateOwnAccountRequest,
} from './accounts.dto'

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
    @Inject(UPDATE_OWN_ACCOUNT) private readonly updateOwnAccount: UpdateOwnAccount,
    @Inject(VERIFY_ACCOUNT) private readonly verifyAccount: VerifyAccount,
    @Inject(CONFIRM_REGISTRATION) private readonly confirmRegistration: ConfirmRegistration,
    @Inject(FIND_ACCOUNT_BY_EMAIL) private readonly findAccountByEmail: FindAccountByEmail,
    @Inject(ASSIGN_ROLE) private readonly assignRole: AssignRole,
    @Inject(REVOKE_ROLE) private readonly revokeRole: RevokeRole,
  ) {}

  /**
   * PUBLICO: quien se registra todavia NO tiene identidad; este endpoint la
   * crea en el proveedor (ADR-004, "Alta server-side"). Antes exigia un
   * testimonio porque la identidad se creaba en la pantalla alojada; ese paso
   * desaparecio.
   */
  @Public()
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
  @ApiResponse({ status: 201, description: 'Cuenta registrada, pendiente de confirmar el correo' })
  @ApiResponse({
    status: 400,
    description: 'Datos invalidos o contrasena que no cumple la politica',
  })
  @ApiResponse({ status: 409, description: 'El correo o el apodo ya estan registrados' })
  @ApiResponse({ status: 503, description: 'El proveedor de identidad no respondio' })
  async register(
    @Body() body: RegisterAccountRequest,
    @UploadedFile() avatar: UploadedAvatar | undefined,
  ): Promise<AccountResponse> {
    try {
      return await this.registerAccount.execute({
        email: body.email,
        password: body.password,
        displayName: body.nickname,
        firstNames: body.firstNames,
        lastNames: body.lastNames,
        termsAccepted: body.termsAccepted,
        privacyPolicyVersion: body.privacyPolicyVersion,
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
      })
    } catch (error: unknown) {
      throw AccountsController.translate(error)
    }
  }

  /**
   * PUBLICO: confirma el correo con el codigo que envio el proveedor y activa
   * la cuenta. No exige testimonio: quien confirma aun no puede iniciar sesion,
   * que es justo lo que este paso desbloquea.
   */
  @Public()
  @Post('confirmation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirma el correo y activa la cuenta (HU-01)' })
  @ApiResponse({ status: 200, description: 'Cuenta activada', type: AccountResponse })
  @ApiResponse({ status: 400, description: 'Codigo invalido o expirado' })
  @ApiResponse({ status: 503, description: 'El proveedor de identidad no respondio' })
  async confirm(@Body() body: ConfirmRegistrationRequest): Promise<AccountResponse> {
    const outcome = await this.confirmRegistration.execute({
      identifier: body.identifier,
      code: body.code,
    })

    if (outcome.kind === 'invalidCode') {
      throw new BadRequestException('El codigo no es valido o ha expirado.')
    }

    if (outcome.kind === 'providerUnavailable') {
      throw new ServiceUnavailableException(
        'El proveedor de identidad no esta disponible. Intentelo de nuevo mas tarde.',
      )
    }

    return outcome.account
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

  /**
   * Self-service: la cuenta se resuelve por el sujeto del testimonio, nunca por
   * un identificador del cuerpo. El contrato solo declara los campos editables,
   * y `forbidNonWhitelisted` rechaza cualquier otro con 400.
   */
  @Patch('me')
  @ApiOperation({ summary: 'Actualiza la informacion personal de la cuenta propia (HU-05)' })
  @ApiResponse({ status: 200, description: 'Cuenta actualizada', type: AccountResponse })
  @ApiResponse({ status: 400, description: 'Datos invalidos o apodo no permitido' })
  @ApiResponse({ status: 401, description: 'Falta el testimonio o no es valido' })
  @ApiResponse({ status: 404, description: 'El sujeto no tiene cuenta en este servicio' })
  @ApiResponse({ status: 409, description: 'El apodo ya esta en uso por otra cuenta' })
  async updateOwn(
    @CurrentIdentity() identity: VerifiedIdentity,
    @Body() body: UpdateOwnAccountRequest,
  ): Promise<AccountResponse> {
    try {
      return await this.updateOwnAccount.execute({
        subject: identity.subject,
        displayName: body.displayName,
      })
    } catch (error: unknown) {
      throw AccountsController.translate(error)
    }
  }

  /** Debe permanecer antes de `:id`: Nest resolveria "search" como identificador. */
  @Roles(Role.SuperAdministrator)
  @Get('search')
  @ApiOperation({ summary: 'Busca una cuenta por correo para gestionar sus roles' })
  @ApiResponse({ status: 200, type: ManagedAccountResponse })
  @ApiResponse({ status: 403, description: 'Solo el Super Administrador puede gestionar roles' })
  async search(@Query() query: FindAccountByEmailQuery): Promise<ManagedAccountResponse> {
    try {
      return await this.findAccountByEmail.execute(query.email)
    } catch (error: unknown) {
      throw AccountsController.translate(error)
    }
  }

  @Roles(Role.SuperAdministrator)
  @Post(':id/roles')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Concede MODERATOR o ADMINISTRATOR a una cuenta' })
  async assign(
    @CurrentIdentity() identity: VerifiedIdentity,
    @Param('id') id: string,
    @Body() body: AssignRoleRequest,
  ): Promise<AccountResponse> {
    try {
      const outcome = await this.assignRole.execute({
        actorSubject: identity.subject,
        targetAccountId: id,
        role: body.role,
      })

      if (outcome.kind === 'mfaRequired') {
        throw new ConflictException(
          'La cuenta debe inscribir su aplicacion autenticadora antes de recibir un rol administrativo.',
        )
      }

      return outcome.account
    } catch (error: unknown) {
      throw AccountsController.translate(error)
    }
  }

  @Roles(Role.SuperAdministrator)
  @Delete(':id/roles/:role')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retira un rol y cierra las sesiones de la cuenta' })
  async revoke(
    @CurrentIdentity() identity: VerifiedIdentity,
    @Param('id') id: string,
    @Param('role') rawRole: string,
  ): Promise<AccountResponse> {
    if (!isRole(rawRole)) {
      throw new BadRequestException('El rol indicado no existe.')
    }

    try {
      return await this.revokeRole.execute({
        actorSubject: identity.subject,
        targetAccountId: id,
        role: rawRole,
      })
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
    if (
      error instanceof RoleDirectoryError ||
      error instanceof IdentitySignUpError ||
      error instanceof MfaStatusError ||
      error instanceof SessionRevocationError
    ) {
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
