import {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
  InternalErrorException,
} from '@aws-sdk/client-cognito-identity-provider'

import { CognitoVerifiedEmailDirectory } from '../../src/adapters/outbound/identity/CognitoVerifiedEmailDirectory'
import { VerifiedEmailDirectoryError } from '../../src/application/ports/VerifiedEmailDirectoryPort'

const withMockedSend = (impl: (command: unknown) => unknown): jest.SpyInstance =>
  jest
    .spyOn(CognitoIdentityProviderClient.prototype, 'send')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- el mock discrimina por comando, no reproduce la sobrecarga completa del SDK
    .mockImplementation(impl as any)

const buildDirectory = (): CognitoVerifiedEmailDirectory =>
  new CognitoVerifiedEmailDirectory({ userPoolId: 'us-east-1_pruebas' })

afterEach(() => {
  jest.restoreAllMocks()
})

describe('CognitoVerifiedEmailDirectory', () => {
  it('consulta AdminGetUser con el pool y el sujeto, y devuelve el correo verificado', async () => {
    const sent: unknown[] = []
    withMockedSend((command) => {
      sent.push(command)

      return {
        UserAttributes: [
          { Name: 'sub', Value: 'sujeto-ana' },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'email', Value: 'Ana@Nexus.TEST' },
        ],
      }
    })

    await expect(buildDirectory().findVerifiedEmail('sujeto-ana')).resolves.toBe('Ana@Nexus.TEST')

    expect(sent).toHaveLength(1)
    expect(sent[0]).toBeInstanceOf(AdminGetUserCommand)
    expect((sent[0] as AdminGetUserCommand).input).toEqual({
      UserPoolId: 'us-east-1_pruebas',
      Username: 'sujeto-ana',
    })
  })

  it.each([
    [
      'no esta verificado',
      [
        { Name: 'email_verified', Value: 'false' },
        { Name: 'email', Value: 'a@nexus.test' },
      ],
    ],
    ['falta la marca de verificacion', [{ Name: 'email', Value: 'a@nexus.test' }]],
    ['falta el correo', [{ Name: 'email_verified', Value: 'true' }]],
    [
      'el correo esta vacio',
      [
        { Name: 'email_verified', Value: 'true' },
        { Name: 'email', Value: '   ' },
      ],
    ],
  ])('devuelve null cuando %s', async (_case, UserAttributes) => {
    withMockedSend(() => ({ UserAttributes }))

    await expect(buildDirectory().findVerifiedEmail('sujeto-ana')).resolves.toBeNull()
  })

  it('traduce el fallo del proveedor y no supone el correo verificado', async () => {
    withMockedSend(() => {
      throw new InternalErrorException({ message: 'servicio no disponible', $metadata: {} })
    })

    await expect(buildDirectory().findVerifiedEmail('sujeto-ana')).rejects.toBeInstanceOf(
      VerifiedEmailDirectoryError,
    )
  })
})
