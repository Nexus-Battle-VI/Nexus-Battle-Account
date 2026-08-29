import {
  AdminAddUserToGroupCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'

import { isRole, type Role } from '../../../domain/entities/Role'
import {
  RoleDirectoryError,
  type RoleDirectoryPort,
} from '../../../application/ports/RoleDirectoryPort'

export interface CognitoRoleDirectoryOptions {
  readonly userPoolId: string
}

/**
 * Adaptador real de `RoleDirectoryPort` sobre los grupos de un pool de Cognito.
 *
 * Los grupos ya existen: los declara Terraform, uno por rol. Este adaptador
 * **no crea ni borra grupos**, solo pertenencias. Un grupo que falte es un
 * defecto de aprovisionamiento, y conviene que se note como fallo en vez de que
 * el adaptador lo cree por su cuenta y la infraestructura deje de describir lo
 * que hay.
 */
export class CognitoRoleDirectory implements RoleDirectoryPort {
  private readonly client: CognitoIdentityProviderClient
  private readonly userPoolId: string

  constructor(options: CognitoRoleDirectoryOptions, client?: CognitoIdentityProviderClient) {
    this.userPoolId = options.userPoolId
    // Sin credenciales explicitas: las toma de la cadena por defecto, que en el
    // nodo es el rol de instancia. Ninguna clave de acceso vive en el proceso.
    this.client = client ?? new CognitoIdentityProviderClient({})
  }

  async reflect(subject: string, roles: readonly Role[]): Promise<void> {
    const deseados = new Set<Role>(roles)

    try {
      const actuales = await this.currentKnownRoles(subject)

      // Se calcula la diferencia en lugar de anadir sin mas: sin retirar lo que
      // sobra, revocar un rol en Account no se reflejaria nunca y el testimonio
      // seguiria concediendolo. Un reflejo que solo suma no es un reflejo.
      const anadir = [...deseados].filter((rol) => !actuales.has(rol))
      const retirar = [...actuales].filter((rol) => !deseados.has(rol))

      for (const rol of anadir) {
        await this.client.send(
          new AdminAddUserToGroupCommand({
            UserPoolId: this.userPoolId,
            Username: subject,
            GroupName: rol,
          }),
        )
      }

      for (const rol of retirar) {
        await this.client.send(
          new AdminRemoveUserFromGroupCommand({
            UserPoolId: this.userPoolId,
            Username: subject,
            GroupName: rol,
          }),
        )
      }
    } catch (error: unknown) {
      const detalle = error instanceof Error ? error.message : String(error)

      throw new RoleDirectoryError(`No se pudo reflejar el rol en el proveedor: ${detalle}`)
    }
  }

  /**
   * Pertenencias actuales, **filtradas al vocabulario de roles conocido**.
   *
   * Un grupo ajeno a ese vocabulario se ignora, y por tanto nunca entra en la
   * lista de lo que hay que retirar. Account refleja los roles que decide; no
   * se apropia del pool ni retira lo que no puso.
   */
  private async currentKnownRoles(subject: string): Promise<Set<Role>> {
    const roles = new Set<Role>()
    let token: string | undefined

    do {
      const respuesta = await this.client.send(
        new AdminListGroupsForUserCommand({
          UserPoolId: this.userPoolId,
          Username: subject,
          NextToken: token,
        }),
      )

      for (const grupo of respuesta.Groups ?? []) {
        const nombre = grupo.GroupName

        if (typeof nombre === 'string' && isRole(nombre)) {
          roles.add(nombre)
        }
      }

      // Se pagina de verdad. Con cuatro grupos posibles una sola pagina basta
      // hoy, pero dar por hecho que la respuesta cabe entera es la clase de
      // suposicion que deja de ser cierta sin avisar.
      token = respuesta.NextToken
    } while (token !== undefined)

    return roles
  }
}
