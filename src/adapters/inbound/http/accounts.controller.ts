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
import { VerifyAccount } from '../../../application/use-cases/VerifyAccount'
import { Role } from '../../../domain/entities/Role'
import { Public, Roles } from './auth/decorators'
import { REGISTER_ACCOUNT, GET_ACCOUNT, VERIFY_ACCOUNT } from './tokens'
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
    @Inject(VERIFY_ACCOUNT) private readonly verifyAccount: VerifyAccount,
  ) {}

  // El registro es la unica operacion que no puede exigir testimonio: quien se
  // registra todavia no tiene ninguno.
  @Public()
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registra una cuenta nueva' })
  @ApiResponse({ status: 201, description: 'Cuenta registrada', type: AccountResponse })
  @ApiResponse({ status: 400, description: 'Datos invalidos' })
  @ApiResponse({ status: 409, description: 'El correo ya esta registrado' })
  async register(@Body() body: RegisterAccountRequest): Promise<AccountResponse> {
    try {
      return await this.registerAccount.execute({
        email: body.email,
        displayName: body.displayName,
      })
    } catch (error: unknown) {
      throw AccountsController.translate(error)
    }
  }

  // Exige testimonio valido, pero NO comprueba propiedad: el agregado todavia
  // no guarda el sujeto de identidad, asi que no hay forma de saber que esta
  // cuenta es la de quien pregunta. Comprobarlo por correo seria un vinculo
  // fragil, y afirmarlo sin comprobarlo seria peor. Queda declarado en el
  // README y es el paso siguiente de ADR-004.
  @Get(':id')
  @ApiOperation({ summary: 'Recupera una cuenta por su identificador' })
  @ApiResponse({ status: 200, description: 'Cuenta encontrada', type: AccountResponse })
  @ApiResponse({ status: 401, description: 'Falta el testimonio o no es valido' })
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
