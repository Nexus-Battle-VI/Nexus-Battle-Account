import {
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider'

import { CognitoIdentityPasswordReset } from '../../src/adapters/outbound/identity/CognitoIdentityPasswordReset'

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

const buildAdapter = (): CognitoIdentityPasswordReset =>
  new CognitoIdentityPasswordReset({ userPoolId: 'us-east-1_pruebas' })

afterEach(() => {
  jest.restoreAllMocks()
})

describe('CognitoIdentityPasswordReset', () => {
  it('establece la contrasena como permanente, con el pool y el correo correctos', async () => {
    const enviados: unknown[] = []
    withMockedSend((command) => {
      enviados.push(command)

      return {}
    })

    const outcome = await buildAdapter().setPassword('jugador@nexus.test', 'NuevaClave9!')

    expect(outcome).toEqual({ kind: 'updated' })
    const [comando] = enviados
    expect(comando).toBeInstanceOf(AdminSetUserPasswordCommand)
    expect((comando as AdminSetUserPasswordCommand).input).toMatchObject({
      UserPoolId: 'us-east-1_pruebas',
      Username: 'jugador@nexus.test',
      Password: 'NuevaClave9!',
      Permanent: true,
    })
  })

  it('traduce cualquier fallo del proveedor a "failed", sin distinguir el motivo', async () => {
    withMockedSend(() => {
      throw new UserNotFoundException({ message: 'no existe', $metadata: {} })
    })

    await expect(buildAdapter().setPassword('nadie@nexus.test', 'NuevaClave9!')).resolves.toEqual({
      kind: 'failed',
    })
  })
})
