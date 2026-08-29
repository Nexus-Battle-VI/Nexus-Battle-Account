import {
  AdminAddUserToGroupCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  CognitoIdentityProviderClient,
  InternalErrorException,
} from '@aws-sdk/client-cognito-identity-provider'

import { CognitoRoleDirectory } from '../../src/adapters/outbound/identity/CognitoRoleDirectory'
import { RoleDirectoryError } from '../../src/application/ports/RoleDirectoryPort'
import { Role } from '../../src/domain/entities/Role'

/**
 * Se intercepta `send` para probar la TRADUCCION del adaptador sin firmar
 * ninguna peticion real ni levantar un pool, igual que
 * `cognito-authentication-provider.spec.ts`.
 */
const withMockedSend = (impl: (command: unknown) => unknown): jest.SpyInstance =>
  jest
    .spyOn(CognitoIdentityProviderClient.prototype, 'send')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- el mock traduce por tipo de comando, no por la firma exacta del SDK
    .mockImplementation(impl as any)

const buildDirectory = (): CognitoRoleDirectory =>
  new CognitoRoleDirectory({ userPoolId: 'us-east-1_pruebas' })

/** Respuesta de `AdminListGroupsForUser` con los grupos indicados. */
const grupos = (...nombres: string[]) => ({ Groups: nombres.map((name) => ({ GroupName: name })) })

afterEach(() => {
  jest.restoreAllMocks()
})

describe('CognitoRoleDirectory', () => {
  it('anade el grupo que falta, con el pool y el sujeto correctos', async () => {
    const enviados: unknown[] = []
    withMockedSend((command) => {
      enviados.push(command)

      return command instanceof AdminListGroupsForUserCommand ? grupos() : {}
    })

    await buildDirectory().reflect('sujeto-ana', [Role.Player])

    const alta = enviados.find(
      (c): c is AdminAddUserToGroupCommand => c instanceof AdminAddUserToGroupCommand,
    )
    expect(alta).toBeInstanceOf(AdminAddUserToGroupCommand)
    expect(alta?.input).toMatchObject({
      UserPoolId: 'us-east-1_pruebas',
      Username: 'sujeto-ana',
      GroupName: Role.Player,
    })
  })

  it('no vuelve a anadir un grupo que el sujeto ya tiene', async () => {
    const enviados: unknown[] = []
    withMockedSend((command) => {
      enviados.push(command)

      return command instanceof AdminListGroupsForUserCommand ? grupos(Role.Player) : {}
    })

    await buildDirectory().reflect('sujeto-ana', [Role.Player])

    expect(enviados.filter((c) => c instanceof AdminAddUserToGroupCommand)).toHaveLength(0)
    expect(enviados.filter((c) => c instanceof AdminRemoveUserFromGroupCommand)).toHaveLength(0)
  })

  /**
   * Un reflejo que solo suma no es un reflejo: revocar un rol en Account nunca
   * llegaria al testimonio, y este seguiria concediendolo hasta que caducara.
   */
  it('retira el rol que Account ya no concede', async () => {
    const enviados: unknown[] = []
    withMockedSend((command) => {
      enviados.push(command)

      return command instanceof AdminListGroupsForUserCommand
        ? grupos(Role.Player, Role.Moderator)
        : {}
    })

    await buildDirectory().reflect('sujeto-ana', [Role.Player])

    const bajas = enviados.filter(
      (c): c is AdminRemoveUserFromGroupCommand => c instanceof AdminRemoveUserFromGroupCommand,
    )
    expect(bajas).toHaveLength(1)
    expect(bajas[0]?.input.GroupName).toBe(Role.Moderator)
  })

  /**
   * Reflejar no es apropiarse del pool. Account gestiona los grupos que
   * corresponden a un rol de su vocabulario; lo que alguien creara a mano por
   * otro motivo no es asunto suyo, y retirarlo seria un efecto colateral que
   * nadie pidio.
   */
  it('deja en paz los grupos ajenos al vocabulario de roles', async () => {
    const enviados: unknown[] = []
    withMockedSend((command) => {
      enviados.push(command)

      return command instanceof AdminListGroupsForUserCommand
        ? grupos(Role.Player, 'equipo-de-soporte')
        : {}
    })

    await buildDirectory().reflect('sujeto-ana', [Role.Player])

    expect(enviados.filter((c) => c instanceof AdminRemoveUserFromGroupCommand)).toHaveLength(0)
  })

  it('recorre todas las paginas antes de decidir que sobra', async () => {
    const enviados: unknown[] = []
    withMockedSend((command) => {
      enviados.push(command)

      if (command instanceof AdminListGroupsForUserCommand) {
        return command.input.NextToken === undefined
          ? { ...grupos(Role.Moderator), NextToken: 'pagina-2' }
          : grupos(Role.Player)
      }

      return {}
    })

    await buildDirectory().reflect('sujeto-ana', [Role.Player])

    // Sin paginar, `PLAYER` habria parecido ausente (se anadiria de nuevo) y
    // `MODERATOR` habria parecido el unico existente.
    expect(enviados.filter((c) => c instanceof AdminAddUserToGroupCommand)).toHaveLength(0)
    const bajas = enviados.filter(
      (c): c is AdminRemoveUserFromGroupCommand => c instanceof AdminRemoveUserFromGroupCommand,
    )
    expect(bajas).toHaveLength(1)
    expect(bajas[0]?.input.GroupName).toBe(Role.Moderator)
  })

  it('traduce el fallo del proveedor a RoleDirectoryError', async () => {
    withMockedSend(() => {
      throw new InternalErrorException({ message: 'servicio no disponible', $metadata: {} })
    })

    await expect(buildDirectory().reflect('sujeto-ana', [Role.Player])).rejects.toBeInstanceOf(
      RoleDirectoryError,
    )
  })

  it('no crea ni borra grupos, solo pertenencias', async () => {
    const enviados: unknown[] = []
    withMockedSend((command) => {
      enviados.push(command)

      return command instanceof AdminListGroupsForUserCommand ? grupos() : {}
    })

    await buildDirectory().reflect('sujeto-ana', [Role.Player])

    // Los grupos los declara Terraform. Que este adaptador los creara dejaria a
    // la infraestructura describiendo algo distinto de lo que existe.
    const nombres = enviados.map((c) => (c as object).constructor.name)
    expect(nombres).not.toContain('CreateGroupCommand')
    expect(nombres).not.toContain('DeleteGroupCommand')
  })
})
