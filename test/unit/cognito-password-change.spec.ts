import {
  ChangePasswordCommand,
  CognitoIdentityProviderClient,
  InvalidPasswordException,
  LimitExceededException,
  NotAuthorizedException,
} from '@aws-sdk/client-cognito-identity-provider'

import { CognitoPasswordChange } from '../../src/adapters/outbound/identity/CognitoPasswordChange'
import { PasswordChangeError } from '../../src/application/ports/PasswordChangePort'

const withMockedSend = (impl: (command: unknown) => unknown): jest.SpyInstance =>
  jest
    .spyOn(CognitoIdentityProviderClient.prototype, 'send')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- el mock traduce por tipo de comando
    .mockImplementation(impl as any)

const buildAdapter = (): CognitoPasswordChange =>
  new CognitoPasswordChange({ userPoolId: 'us-east-1_pruebas' })

const meta = { $metadata: {} }

afterEach(() => {
  jest.restoreAllMocks()
})

describe('CognitoPasswordChange', () => {
  it('envia ChangePassword con el testimonio y ambas contrasenas y confirma el cambio', async () => {
    let sent: ChangePasswordCommand | undefined

    withMockedSend((command) => {
      if (command instanceof ChangePasswordCommand) {
        sent = command
        return { ...meta }
      }
      throw new Error('comando inesperado')
    })

    const outcome = await buildAdapter().changePassword('token-acceso', 'actual', 'nueva-larga-1')

    expect(outcome).toEqual({ kind: 'changed' })
    expect(sent?.input).toEqual({
      AccessToken: 'token-acceso',
      PreviousPassword: 'actual',
      ProposedPassword: 'nueva-larga-1',
    })
  })

  it('trata NotAuthorizedException como contrasena actual incorrecta', async () => {
    withMockedSend(() => {
      throw new NotAuthorizedException({
        message: 'Incorrect username or password.',
        $metadata: {},
      })
    })

    const outcome = await buildAdapter().changePassword('token-acceso', 'mal', 'nueva-larga-1')

    expect(outcome).toEqual({ kind: 'invalidCurrentPassword' })
  })

  it('trata InvalidPasswordException como contrasena nueva rechazada por politica', async () => {
    withMockedSend(() => {
      throw new InvalidPasswordException({
        message: 'Password does not meet policy',
        $metadata: {},
      })
    })

    const outcome = await buildAdapter().changePassword('token-acceso', 'actual', 'debil')

    expect(outcome.kind).toBe('weakPassword')
  })

  it('trata el limite de intentos como fallo del proveedor, no como codigo/credencial', async () => {
    withMockedSend(() => {
      throw new LimitExceededException({ message: 'Attempt limit exceeded', $metadata: {} })
    })

    await expect(
      buildAdapter().changePassword('token-acceso', 'actual', 'nueva-larga-1'),
    ).rejects.toBeInstanceOf(PasswordChangeError)
  })

  it('envuelve un error inesperado como fallo del proveedor sin filtrar las contrasenas', async () => {
    withMockedSend(() => {
      throw new Error('detalle interno con actual y nueva-larga-1 dentro')
    })

    await expect(
      buildAdapter().changePassword('token-acceso', 'actual', 'nueva-larga-1'),
    ).rejects.toMatchObject({
      name: 'PasswordChangeError',
      message: expect.not.stringContaining('nueva-larga-1'),
    })
  })
})
