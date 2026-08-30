import {
  AssociateSoftwareTokenCommand,
  CodeMismatchException,
  CognitoIdentityProviderClient,
  EnableSoftwareTokenMFAException,
  SetUserMFAPreferenceCommand,
  VerifySoftwareTokenCommand,
} from '@aws-sdk/client-cognito-identity-provider'

import { CognitoTotpEnrollment } from '../../src/adapters/outbound/identity/CognitoTotpEnrollment'
import { TotpEnrollmentError } from '../../src/application/ports/TotpEnrollmentPort'

const withMockedSend = (impl: (command: unknown) => unknown): jest.SpyInstance =>
  jest
    .spyOn(CognitoIdentityProviderClient.prototype, 'send')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- el mock traduce por tipo de comando
    .mockImplementation(impl as any)

const buildAdapter = (): CognitoTotpEnrollment =>
  new CognitoTotpEnrollment({ userPoolId: 'us-east-1_pruebas' })

const meta = { $metadata: {} }

afterEach(() => {
  jest.restoreAllMocks()
})

describe('CognitoTotpEnrollment', () => {
  it('devuelve el secreto que asocia el proveedor', async () => {
    withMockedSend((command) => {
      if (command instanceof AssociateSoftwareTokenCommand) {
        return { SecretCode: 'SECRETO-BASE32', ...meta }
      }
      throw new Error('comando inesperado')
    })

    const outcome = await buildAdapter().associate('token-de-acceso')

    expect(outcome).toEqual({ secret: 'SECRETO-BASE32' })
  })

  it('falla si el proveedor no devuelve secreto', async () => {
    withMockedSend(() => ({ ...meta }))

    await expect(buildAdapter().associate('token-de-acceso')).rejects.toBeInstanceOf(
      TotpEnrollmentError,
    )
  })

  it('confirma un codigo valido y deja TOTP como preferido', async () => {
    const commands: string[] = []

    withMockedSend((command) => {
      if (command instanceof VerifySoftwareTokenCommand) {
        commands.push('verify')
        return { Status: 'SUCCESS', ...meta }
      }
      if (command instanceof SetUserMFAPreferenceCommand) {
        commands.push('prefer')
        return { ...meta }
      }
      throw new Error('comando inesperado')
    })

    const outcome = await buildAdapter().confirm('token-de-acceso', '123456')

    expect(outcome).toEqual({ kind: 'confirmed' })
    // El orden importa: no se marca preferido un factor que no se verifico.
    expect(commands).toEqual(['verify', 'prefer'])
  })

  /**
   * El control del caso anterior: un codigo equivocado NO marca el factor como
   * preferido. Cognito lo senala lanzando, y la preferencia no debe llegar a
   * enviarse.
   */
  it.each([
    ['CodeMismatch', new CodeMismatchException({ message: 'no coincide', $metadata: {} })],
    [
      'EnableSoftwareTokenMFA',
      new EnableSoftwareTokenMFAException({ message: 'code mismatch', $metadata: {} }),
    ],
  ])('trata %s como codigo invalido y no marca preferencia', async (_name, error) => {
    let preferred = false

    withMockedSend((command) => {
      if (command instanceof VerifySoftwareTokenCommand) {
        throw error
      }
      if (command instanceof SetUserMFAPreferenceCommand) {
        preferred = true
        return { ...meta }
      }
      throw new Error('comando inesperado')
    })

    const outcome = await buildAdapter().confirm('token-de-acceso', '000000')

    expect(outcome).toEqual({ kind: 'invalidCode' })
    expect(preferred).toBe(false)
  })

  it('trata Status distinto de SUCCESS como codigo invalido', async () => {
    withMockedSend((command) => {
      if (command instanceof VerifySoftwareTokenCommand) {
        return { Status: 'ERROR', ...meta }
      }
      throw new Error('comando inesperado')
    })

    const outcome = await buildAdapter().confirm('token-de-acceso', '000000')

    expect(outcome).toEqual({ kind: 'invalidCode' })
  })
})
