import {
  AdminGetUserCommand,
  AdminUserGlobalSignOutCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'

import { CognitoMfaStatus } from '../../src/adapters/outbound/identity/CognitoMfaStatus'
import { CognitoSessionRevocation } from '../../src/adapters/outbound/identity/CognitoSessionRevocation'
import { MfaStatusError } from '../../src/application/ports/MfaStatusPort'
import { SessionRevocationError } from '../../src/application/ports/SessionRevocationPort'

const withMockedSend = (impl: (command: unknown) => unknown): jest.SpyInstance =>
  jest
    .spyOn(CognitoIdentityProviderClient.prototype, 'send')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- el mock discrimina el comando en runtime
    .mockImplementation(impl as any)

afterEach(() => {
  jest.restoreAllMocks()
})

describe('CognitoMfaStatus', () => {
  it('usa UserMFASettingList y reconoce SOFTWARE_TOKEN_MFA', async () => {
    withMockedSend((command) => {
      expect(command).toBeInstanceOf(AdminGetUserCommand)
      return { UserMFASettingList: ['SOFTWARE_TOKEN_MFA'], $metadata: {} }
    })

    const adapter = new CognitoMfaStatus({ userPoolId: 'us-east-1_pruebas' })

    await expect(adapter.hasConfirmedTotp('subject-target')).resolves.toBe(true)
  })

  it('falla cerrado cuando no puede consultar Cognito', async () => {
    withMockedSend(() => Promise.reject(new Error('no disponible')))

    await expect(
      new CognitoMfaStatus({ userPoolId: 'us-east-1_pruebas' }).hasConfirmedTotp('subject-target'),
    ).rejects.toBeInstanceOf(MfaStatusError)
  })
})

describe('CognitoSessionRevocation', () => {
  it('ejecuta AdminUserGlobalSignOut para el sujeto retirado', async () => {
    withMockedSend((command) => {
      expect(command).toBeInstanceOf(AdminUserGlobalSignOutCommand)
      expect((command as AdminUserGlobalSignOutCommand).input).toEqual({
        UserPoolId: 'us-east-1_pruebas',
        Username: 'subject-target',
      })
      return { $metadata: {} }
    })

    await expect(
      new CognitoSessionRevocation({ userPoolId: 'us-east-1_pruebas' }).globalSignOut(
        'subject-target',
      ),
    ).resolves.toBeUndefined()
  })

  it('traduce el fallo del proveedor', async () => {
    withMockedSend(() => Promise.reject(new Error('no disponible')))

    await expect(
      new CognitoSessionRevocation({ userPoolId: 'us-east-1_pruebas' }).globalSignOut(
        'subject-target',
      ),
    ).rejects.toBeInstanceOf(SessionRevocationError)
  })
})
