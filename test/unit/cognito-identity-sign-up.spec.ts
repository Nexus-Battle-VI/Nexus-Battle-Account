import {
  CodeMismatchException,
  CognitoIdentityProviderClient,
  ConfirmSignUpCommand,
  ExpiredCodeException,
  NotAuthorizedException,
  SignUpCommand,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider'

import { CognitoIdentitySignUp } from '../../src/adapters/outbound/identity/CognitoIdentitySignUp'
import { IdentitySignUpError } from '../../src/application/ports/IdentitySignUpPort'

/**
 * Se intercepta `send` y se prueba solo la TRADUCCION del adaptador, sin firmar
 * ninguna peticion real ni levantar un pool. Mismo principio que el resto de
 * adaptadores de este servicio.
 */
const withMockedSend = (impl: (command: unknown) => unknown): jest.SpyInstance =>
  jest
    .spyOn(CognitoIdentityProviderClient.prototype, 'send')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- el mock traduce por tipo de comando
    .mockImplementation(impl as any)

const buildAdapter = (): CognitoIdentitySignUp =>
  new CognitoIdentitySignUp({ userPoolId: 'us-east-1_pruebas', clientId: 'cliente-app' })

const meta = { $metadata: {} }

afterEach(() => {
  jest.restoreAllMocks()
})

describe('CognitoIdentitySignUp', () => {
  it('devuelve el sujeto que asigna el proveedor', async () => {
    withMockedSend((command) => {
      if (command instanceof SignUpCommand) {
        return { UserSub: 'sub-asignado', UserConfirmed: false, ...meta }
      }
      throw new Error('comando inesperado')
    })

    const outcome = await buildAdapter().signUp('nuevo@nexus.test', 'Abcdefg1!')

    expect(outcome).toEqual({ kind: 'created', subject: 'sub-asignado' })
  })

  it('distingue "correo ya existe" de un fallo del proveedor', async () => {
    withMockedSend(() => {
      throw new UsernameExistsException({ message: 'ya existe', $metadata: {} })
    })

    const outcome = await buildAdapter().signUp('repetido@nexus.test', 'Abcdefg1!')

    expect(outcome).toEqual({ kind: 'emailTaken' })
  })

  /**
   * El proveedor no devolvio sujeto: no se puede vincular la cuenta a nadie. Es
   * un fallo, no un alta a medias que se persiste.
   */
  it('falla si el proveedor no devuelve sujeto', async () => {
    withMockedSend(() => ({ UserConfirmed: false, ...meta }))

    await expect(buildAdapter().signUp('x@nexus.test', 'Abcdefg1!')).rejects.toBeInstanceOf(
      IdentitySignUpError,
    )
  })

  it('confirma con un codigo valido', async () => {
    withMockedSend((command) => {
      if (command instanceof ConfirmSignUpCommand) {
        return { ...meta }
      }
      throw new Error('comando inesperado')
    })

    const outcome = await buildAdapter().confirmSignUp('x@nexus.test', '123456')

    expect(outcome).toEqual({ kind: 'confirmed' })
  })

  it.each([
    ['invalidCode', new CodeMismatchException({ message: 'no coincide', $metadata: {} })],
    ['expired', new ExpiredCodeException({ message: 'expiro', $metadata: {} })],
    ['alreadyConfirmed', new NotAuthorizedException({ message: 'ya confirmada', $metadata: {} })],
  ])('mapea el fallo de confirmacion a %s', async (kind, error) => {
    withMockedSend(() => {
      throw error
    })

    const outcome = await buildAdapter().confirmSignUp('x@nexus.test', '000000')

    expect(outcome).toEqual({ kind })
  })
})
