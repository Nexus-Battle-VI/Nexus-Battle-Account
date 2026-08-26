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
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'

import { DomainError } from '../../../domain/errors/DomainError'
import {
  AccountAlreadyExistsError,
  AccountNotFoundError,
} from '../../../application/errors/ApplicationError'
import { RegisterAccount } from '../../../application/use-cases/RegisterAccount'
import { GetAccount } from '../../../application/use-cases/GetAccount'
import { GetOwnAccount } from '../../../application/use-cases/GetOwnAccount'
import { VerifyAccount } from '../../../application/use-cases/VerifyAccount'
import { Role } from '../../../domain/entities/Role'
import { CurrentIdentity, Roles } from './auth/decorators'
import { ANONYMOUS_IDENTITY } from './auth/anonymous.guard'
import type { VerifiedIdentity } from '../../../application/ports/TokenVerifierPort'
import { REGISTER_ACCOUNT, GET_ACCOUNT, GET_OWN_ACCOUNT, VERIFY_ACCOUNT } from './tokens'
import { AccountResponse, RegisterAccountRequest } from './accounts.dto'

/**
 * Adaptador de entrada HTTP.
 *
 * Su unica responsabilidad es traducir entre el protocolo y los casos de uso:
 * valida la forma de la peticion, invoca el caso de uso y convierte los errores
 * de dominio y de aplicacion en codigos HTTP. No contiene reglas de negocio.
 */
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

  /**
   * Crea el perfil local de una persona que YA existe en el proveedor.
   *
   * Exige testimonio, y eso no es una restriccion arbitraria: con un proveedor
   * real, el alta ocurre en su propia pantalla de registro. Cuando se llega
   * aqui, la identidad ya existe y lo que falta es la cuenta del producto.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registra la cuenta asociada al testimonio' })
  @ApiResponse({ status: 201, description: 'Cuenta registrada', type: AccountResponse })
  @ApiResponse({ status: 400, description: 'Datos invalidos' })
  @ApiResponse({ status: 401, description: 'Falta el testimonio o no es valido' })
  @ApiResponse({ status: 409, description: 'El correo ya esta registrado' })
  async register(
    @Body() body: RegisterAccountRequest,
    @CurrentIdentity() identity: VerifiedIdentity,
  ): Promise<AccountResponse> {
    try {
      // La identidad anonima NO es un sujeto: todas las peticiones comparten la
      // misma cadena. Vincular cuentas a ella las haria indistinguibles entre
      // si, asi que en ese caso se deja que el proveedor genere un sujeto.
      const subject = identity.subject === ANONYMOUS_IDENTITY.subject ? undefined : identity.subject

      return await this.registerAccount.execute({
        email: body.email,
        displayName: body.displayName,
        ...(subject === undefined ? {} : { subject }),
      })
    } catch (error: unknown) {
      throw AccountsController.translate(error)
    }
  }

  /**
   * La propia cuenta, resuelta por el sujeto del testimonio.
   *
   * Se declara ANTES de `:id` a proposito: NestJS resuelve las rutas en orden
   * de declaracion, y al reves el parametro capturaria la cadena literal `me`.
   */
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
   * Lectura de una cuenta ARBITRARIA por su identificador interno.
   *
   * Exige rol de administrador. Una persona no necesita esta ruta para leer su
   * propia cuenta: para eso esta `/me`, que no obliga a conocer ni a exponer
   * identificadores internos.
   */
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

  /**
   * Traduce los errores de las capas interiores a codigos HTTP. El dominio y la
   * aplicacion no conocen HTTP, por lo que la correspondencia vive aqui.
   */
  private static translate(error: unknown): Error {
    if (error instanceof AccountAlreadyExistsError) {
      return new ConflictException(error.message)
    }

    if (error instanceof AccountNotFoundError) {
      return new NotFoundException(error.message)
    }

    if (error instanceof DomainError) {
      return new BadRequestException(error.message)
    }

    return error instanceof Error ? error : new Error('Fallo desconocido del servicio.')
  }
}
