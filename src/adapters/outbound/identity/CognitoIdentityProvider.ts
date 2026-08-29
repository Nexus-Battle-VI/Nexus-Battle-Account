import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  UserNotFoundException,
  UsernameExistsException,
  type AdminCreateUserCommandOutput,
} from '@aws-sdk/client-cognito-identity-provider'

import {
  IdentityProviderError,
  type IdentityProviderPort,
  type IdentityRegistrationInput,
  type IdentitySubject,
} from '../../../application/ports/IdentityProviderPort'

export interface CognitoIdentityProviderOptions {
  readonly userPoolId: string
  /**
   * Grupo que recibe toda cuenta recien registrada.
   *
   * Existe porque los OTROS servicios leen el rol de `cognito:groups` del
   * testimonio, no de la base de Account. Sin esta linea, un jugador recien
   * registrado obtiene un testimonio sin grupos y Catalog, Community, Commerce
   * y Player/Inventory lo tratan como si no tuviera ningun rol.
   */
  readonly defaultGroup?: string
}

/**
 * Adaptador real de `IdentityProviderPort` sobre Amazon Cognito.
 *
 * Es la pieza que faltaba para que HU-01 produzca cuentas utilizables. Con
 * `AUTHENTICATION_DRIVER=cognito` y `FakeIdentityProvider`, el registro
 * inventaba un `subject` que no existia en el pool: la cuenta quedaba en
 * PostgreSQL y el login preguntaba a Cognito por un usuario que nadie habia
 * creado. El resultado era una cuenta que **nunca podia iniciar sesion**.
 *
 * Tres decisiones que conviene no perder:
 *
 * `MessageAction: SUPPRESS`. Cognito no envia su propio correo de invitacion.
 * El correo de bienvenida lo emite el contexto Notifications con la plantilla
 * `account-welcome`, que es donde vive el contrato de correo del sistema. Dos
 * remitentes para el mismo hecho serian dos verdades sobre lo mismo.
 *
 * `email_verified: false`. La cuenta nace `PENDING_VERIFICATION` en el dominio;
 * declararla verificada en el pool seria afirmar algo que nadie comprobo, y
 * `readVerifiedEmail` del verificador —con razon— solo acepta el correo cuando
 * el proveedor lo declara verificado.
 *
 * La contrasena se fija como **permanente**. `AdminCreateUser` deja al usuario
 * en `FORCE_CHANGE_PASSWORD`, un estado en el que `AdminInitiateAuth` responde
 * con un reto en vez de un testimonio. El usuario ya eligio su contrasena en el
 * formulario de registro: obligarle a cambiarla acto seguido no protege nada.
 */
export class CognitoIdentityProvider implements IdentityProviderPort {
  private readonly client: CognitoIdentityProviderClient
  private readonly options: CognitoIdentityProviderOptions

  constructor(options: CognitoIdentityProviderOptions, client?: CognitoIdentityProviderClient) {
    this.options = options
    this.client = client ?? new CognitoIdentityProviderClient({})
  }

  async register(input: IdentityRegistrationInput): Promise<IdentitySubject> {
    const email = input.email.trim().toLowerCase()

    if (input.password.length === 0) {
      throw new IdentityProviderError('La contrasena es obligatoria.')
    }

    let creado: AdminCreateUserCommandOutput

    try {
      creado = await this.client.send(
        new AdminCreateUserCommand({
          UserPoolId: this.options.userPoolId,
          Username: email,
          MessageAction: 'SUPPRESS',
          UserAttributes: [
            { Name: 'email', Value: email },
            { Name: 'email_verified', Value: 'false' },
          ],
        }),
      )
    } catch (error: unknown) {
      if (error instanceof UsernameExistsException) {
        throw new IdentityProviderError(`El correo "${email}" ya tiene un sujeto registrado.`)
      }

      throw new IdentityProviderError(CognitoIdentityProvider.describe(error))
    }

    const subject = CognitoIdentityProvider.readSubject(creado)

    // A partir de aqui el usuario YA existe en el pool. Si algo falla despues,
    // se borra antes de propagar el error: dejarlo a medias produciria un
    // usuario sin contrasena utilizable que ademas bloquea el correo para un
    // reintento.
    try {
      await this.client.send(
        new AdminSetUserPasswordCommand({
          UserPoolId: this.options.userPoolId,
          Username: email,
          Password: input.password,
          Permanent: true,
        }),
      )

      if (this.options.defaultGroup !== undefined) {
        await this.client.send(
          new AdminAddUserToGroupCommand({
            UserPoolId: this.options.userPoolId,
            Username: email,
            GroupName: this.options.defaultGroup,
          }),
        )
      }
    } catch (error: unknown) {
      await this.revoke(subject).catch(() => undefined)

      throw new IdentityProviderError(CognitoIdentityProvider.describe(error))
    }

    return { subject, email }
  }

  /**
   * `ListUsers` con filtro y no `AdminGetUser`: el nombre de usuario del pool es
   * el `sub`, no el correo, asi que buscar por correo exige filtrar.
   */
  async findByEmail(email: string): Promise<IdentitySubject | null> {
    const normalizado = email.trim().toLowerCase()

    let salida
    try {
      salida = await this.client.send(
        new ListUsersCommand({
          UserPoolId: this.options.userPoolId,
          Filter: `email = "${normalizado}"`,
          Limit: 1,
        }),
      )
    } catch (error: unknown) {
      throw new IdentityProviderError(CognitoIdentityProvider.describe(error))
    }

    const usuario = salida.Users?.[0]

    if (usuario === undefined) {
      return null
    }

    const subject = usuario.Attributes?.find((a) => a.Name === 'sub')?.Value

    if (subject === undefined || subject.length === 0) {
      // Un usuario sin `sub` no identifica a nadie. Devolver algo aqui haria que
      // el registro creyera que el correo ya esta tomado por un sujeto que no
      // se puede nombrar.
      throw new IdentityProviderError(
        `El pool devolvio un usuario sin "sub" para "${normalizado}".`,
      )
    }

    return { subject, email: normalizado }
  }

  /**
   * Borra, no deshabilita.
   *
   * `revoke` solo se invoca para compensar un registro que fallo despues de
   * crear la identidad: el usuario acaba de nacer y no tiene historia que
   * conservar. Deshabilitarlo dejaria el correo ocupado para siempre y ningun
   * reintento del registro podria completarse.
   */
  async revoke(subject: string): Promise<void> {
    try {
      await this.client.send(
        new AdminDeleteUserCommand({ UserPoolId: this.options.userPoolId, Username: subject }),
      )
    } catch (error: unknown) {
      if (error instanceof UserNotFoundException) {
        return
      }

      throw new IdentityProviderError(CognitoIdentityProvider.describe(error))
    }
  }

  private static readSubject(salida: AdminCreateUserCommandOutput): string {
    const subject = salida.User?.Attributes?.find((a) => a.Name === 'sub')?.Value

    if (subject === undefined || subject.length === 0) {
      throw new IdentityProviderError('El pool creo el usuario sin devolver su "sub".')
    }

    return subject
  }

  private static describe(error: unknown): string {
    return error instanceof Error ? error.message : 'Fallo del proveedor de identidad.'
  }
}
