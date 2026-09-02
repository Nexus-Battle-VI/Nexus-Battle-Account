import {
  AdminInitiateAuthCommand,
  AdminRespondToAuthChallengeCommand,
  ChallengeNameType,
  CodeMismatchException,
  CognitoIdentityProviderClient,
  ExpiredCodeException,
  InternalErrorException,
  NotAuthorizedException,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider'

import { CognitoAuthenticationProvider } from '../../src/adapters/outbound/identity/CognitoAuthenticationProvider'
import {
  AuthenticationProviderError,
  SecondFactorMethod,
} from '../../src/application/ports/AuthenticationProviderPort'

/**
 * `AdminInitiateAuth`/`AdminRespondToAuthChallenge` SI llevan SigV4 (a
 * diferencia de las variantes publicas `InitiateAuth`/`RespondToAuthChallenge`):
 * lo unico que hace falta para probar la TRADUCCION de este adaptador es
 * interceptar `send`, sin firmar ninguna peticion real ni levantar un pool.
 * Es el mismo principio que ya aplica `auth.spec.ts` con `toVerifiedIdentity`:
 * la logica propia se prueba aislada de la biblioteca.
 */
const withMockedSend = (impl: (command: unknown) => unknown): jest.SpyInstance => {
  return (
    jest
      .spyOn(CognitoIdentityProviderClient.prototype, 'send')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- el mock traduce por tipo de comando, no por la firma exacta del SDK
      .mockImplementation(impl as any)
  )
}

const buildProvider = (): CognitoAuthenticationProvider =>
  new CognitoAuthenticationProvider({ userPoolId: 'us-east-1_pruebas', clientId: 'cliente-app' })

afterEach(() => {
  jest.restoreAllMocks()
})

describe('CognitoAuthenticationProvider', () => {
  describe('authenticate', () => {
    it('usa AdminInitiateAuth con ADMIN_USER_PASSWORD_AUTH, el pool y el cliente correctos', async () => {
      const send = withMockedSend((command) => {
        expect(command).toBeInstanceOf(AdminInitiateAuthCommand)
        const input = (command as AdminInitiateAuthCommand).input

        expect(input.AuthFlow).toBe('ADMIN_USER_PASSWORD_AUTH')
        expect(input.UserPoolId).toBe('us-east-1_pruebas')
        expect(input.ClientId).toBe('cliente-app')
        expect(input.AuthParameters).toEqual({
          USERNAME: 'jugador@nexus.test',
          PASSWORD: 'Abcdefg1!',
        })

        return Promise.resolve({
          AuthenticationResult: { AccessToken: 'token-real', ExpiresIn: 3600 },
        })
      })

      const outcome = await buildProvider().authenticate({
        email: 'jugador@nexus.test',
        password: 'Abcdefg1!',
      })

      expect(outcome).toEqual({ kind: 'authenticated', accessToken: 'token-real', expiresIn: 3600 })
      expect(send).toHaveBeenCalledTimes(1)
    })

    it('el accessToken y el expiresIn de la respuesta authenticated provienen literalmente de Cognito', async () => {
      withMockedSend(() =>
        Promise.resolve({
          AuthenticationResult: { AccessToken: 'exactamente-este-token', ExpiresIn: 1800 },
        }),
      )

      const outcome = await buildProvider().authenticate({
        email: 'jugador@nexus.test',
        password: 'Abcdefg1!',
      })

      expect(outcome).toMatchObject({ accessToken: 'exactamente-este-token', expiresIn: 1800 })
    })

    it('contrasena invalida se traduce a invalidCredentials, no a un error', async () => {
      withMockedSend(() =>
        Promise.reject(
          new NotAuthorizedException({ message: 'Incorrect username or password.', $metadata: {} }),
        ),
      )

      await expect(
        buildProvider().authenticate({ email: 'jugador@nexus.test', password: 'incorrecta' }),
      ).resolves.toEqual({ kind: 'invalidCredentials' })
    })

    /**
     * El mismo resultado que una contrasena incorrecta: distinguir "no existe
     * en Cognito" filtraria si una cuenta esta dada de alta en el proveedor.
     */
    it('usuario inexistente en Cognito se traduce a invalidCredentials, igual que contrasena incorrecta', async () => {
      withMockedSend(() =>
        Promise.reject(
          new UserNotFoundException({ message: 'User does not exist.', $metadata: {} }),
        ),
      )

      const porUsuarioInexistente = await buildProvider().authenticate({
        email: 'nadie@nexus.test',
        password: 'lo-que-sea',
      })

      await expect(
        buildProvider().authenticate({ email: 'jugador@nexus.test', password: 'incorrecta' }),
      ).resolves.toEqual(porUsuarioInexistente)
    })

    it('un reto de segundo factor soportado (SOFTWARE_TOKEN_MFA) se empaqueta en un challengeToken opaco', async () => {
      withMockedSend(() =>
        Promise.resolve({
          ChallengeName: ChallengeNameType.SOFTWARE_TOKEN_MFA,
          Session: 'sesion-cognito-abc',
        }),
      )

      const outcome = await buildProvider().authenticate({
        email: 'admin@nexus.test',
        password: 'Abcdefg1!',
      })

      expect(outcome).toEqual({
        kind: 'challengeRequired',
        challengeToken: 'SOFTWARE_TOKEN_MFA:sesion-cognito-abc',
        // El token sigue siendo opaco. El metodo va APARTE justo para que nadie
        // tenga que destriparlo para saber donde mirar.
        method: 'AUTHENTICATOR_APP',
      })
    })

    /**
     * `NEW_PASSWORD_REQUIRED` no es "ingresa un codigo": Web solo sabe
     * resolver un formulario de codigo, y tratar este reto como
     * `challengeRequired` fingiria un flujo que HU-02 no define. Debe fallar
     * cerrado, no inventar una respuesta.
     */
    it.each([
      ChallengeNameType.NEW_PASSWORD_REQUIRED,
      ChallengeNameType.MFA_SETUP,
      ChallengeNameType.SELECT_MFA_TYPE,
      ChallengeNameType.WEB_AUTHN,
    ])(
      'un reto no soportado por HU-02 (%s) falla cerrado, no se trata como challengeRequired',
      async (challengeName) => {
        withMockedSend(() =>
          Promise.resolve({ ChallengeName: challengeName, Session: 'sesion-cognito-abc' }),
        )

        await expect(
          buildProvider().authenticate({ email: 'jugador@nexus.test', password: 'Abcdefg1!' }),
        ).rejects.toBeInstanceOf(AuthenticationProviderError)
      },
    )

    /**
     * Un error de red o del servicio de AWS NO es lo mismo que una contrasena
     * incorrecta: traducirlo como tal ocultaria una caida real detras de un
     * 401, exactamente lo que ya evita `JwtAuthGuard` para la verificacion de
     * testimonios (`auth.spec.ts`, "no convierte un fallo de red en 401").
     */
    it('un error inesperado de AWS se propaga como AuthenticationProviderError, no como invalidCredentials', async () => {
      withMockedSend(() =>
        Promise.reject(new InternalErrorException({ message: 'boom', $metadata: {} })),
      )

      await expect(
        buildProvider().authenticate({ email: 'jugador@nexus.test', password: 'Abcdefg1!' }),
      ).rejects.toBeInstanceOf(AuthenticationProviderError)
    })

    it('no incluye la contrasena en el mensaje de un error inesperado', async () => {
      withMockedSend(() =>
        Promise.reject(new InternalErrorException({ message: 'boom', $metadata: {} })),
      )

      await expect(
        buildProvider().authenticate({
          email: 'jugador@nexus.test',
          password: 'ContrasenaSecreta1!',
        }),
      ).rejects.toMatchObject({
        message: expect.not.stringContaining('ContrasenaSecreta1!'),
      })
    })
  })

  describe('verifySecondFactor', () => {
    const challengeToken = 'SOFTWARE_TOKEN_MFA:sesion-cognito-abc'

    it('usa AdminRespondToAuthChallenge con el pool, el cliente y el parametro de codigo de SOFTWARE_TOKEN_MFA', async () => {
      const send = withMockedSend((command) => {
        expect(command).toBeInstanceOf(AdminRespondToAuthChallengeCommand)
        const input = (command as AdminRespondToAuthChallengeCommand).input

        expect(input.UserPoolId).toBe('us-east-1_pruebas')
        expect(input.ClientId).toBe('cliente-app')
        expect(input.ChallengeName).toBe('SOFTWARE_TOKEN_MFA')
        expect(input.Session).toBe('sesion-cognito-abc')
        expect(input.ChallengeResponses).toEqual({
          USERNAME: 'admin@nexus.test',
          SOFTWARE_TOKEN_MFA_CODE: '123456',
        })

        return Promise.resolve({
          AuthenticationResult: { AccessToken: 'token-admin', ExpiresIn: 3600 },
        })
      })

      const outcome = await buildProvider().verifySecondFactor({
        email: 'admin@nexus.test',
        challengeToken,
        code: '123456',
      })

      expect(outcome).toEqual({
        kind: 'verified',
        accessToken: 'token-admin',
        expiresIn: 3600,
        method: SecondFactorMethod.AuthenticatorApp,
      })
      expect(send).toHaveBeenCalledTimes(1)
    })

    it.each([
      [ChallengeNameType.SOFTWARE_TOKEN_MFA, SecondFactorMethod.AuthenticatorApp],
      [ChallengeNameType.SMS_MFA, SecondFactorMethod.Sms],
      [ChallengeNameType.EMAIL_OTP, SecondFactorMethod.Email],
    ])('deriva %s como metodo %s del reto verificado', async (challengeName, method) => {
      withMockedSend(() =>
        Promise.resolve({ AuthenticationResult: { AccessToken: 'token', ExpiresIn: 900 } }),
      )

      const outcome = await buildProvider().verifySecondFactor({
        email: 'admin@nexus.test',
        challengeToken: `${challengeName}:sesion-cognito`,
        code: '123456',
      })

      expect(outcome).toMatchObject({ kind: 'verified', method })
    })

    it('el accessToken y el expiresIn de verified provienen literalmente de Cognito', async () => {
      withMockedSend(() =>
        Promise.resolve({
          AuthenticationResult: { AccessToken: 'exactamente-este-token-admin', ExpiresIn: 900 },
        }),
      )

      const outcome = await buildProvider().verifySecondFactor({
        email: 'admin@nexus.test',
        challengeToken,
        code: '123456',
      })

      expect(outcome).toMatchObject({
        accessToken: 'exactamente-este-token-admin',
        expiresIn: 900,
      })
    })

    it('un codigo incorrecto se traduce a invalidCode', async () => {
      withMockedSend(() =>
        Promise.reject(new CodeMismatchException({ message: 'Invalid code.', $metadata: {} })),
      )

      await expect(
        buildProvider().verifySecondFactor({
          email: 'admin@nexus.test',
          challengeToken,
          code: '000000',
        }),
      ).resolves.toEqual({ kind: 'invalidCode' })
    })

    it('un codigo expirado se traduce a challengeExpired', async () => {
      withMockedSend(() =>
        Promise.reject(new ExpiredCodeException({ message: 'Code expired.', $metadata: {} })),
      )

      await expect(
        buildProvider().verifySecondFactor({
          email: 'admin@nexus.test',
          challengeToken,
          code: '123456',
        }),
      ).resolves.toEqual({ kind: 'challengeExpired' })
    })

    it('un challengeToken con formato desconocido se trata como expirado, sin llamar a Cognito', async () => {
      const send = withMockedSend(() => Promise.resolve({}))

      await expect(
        buildProvider().verifySecondFactor({
          email: 'admin@nexus.test',
          challengeToken: 'esto-no-tiene-el-formato-esperado',
          code: '123456',
        }),
      ).resolves.toEqual({ kind: 'challengeExpired' })
      expect(send).not.toHaveBeenCalled()
    })

    it('un error inesperado de AWS se propaga como AuthenticationProviderError', async () => {
      withMockedSend(() =>
        Promise.reject(new InternalErrorException({ message: 'boom', $metadata: {} })),
      )

      await expect(
        buildProvider().verifySecondFactor({
          email: 'admin@nexus.test',
          challengeToken,
          code: '123456',
        }),
      ).rejects.toBeInstanceOf(AuthenticationProviderError)
    })

    it('no incluye el codigo ni el testimonio en el mensaje de un error inesperado', async () => {
      withMockedSend(() =>
        Promise.reject(new InternalErrorException({ message: 'boom', $metadata: {} })),
      )

      await expect(
        buildProvider().verifySecondFactor({
          email: 'admin@nexus.test',
          challengeToken,
          code: '999999',
        }),
      ).rejects.toMatchObject({
        message: expect.not.stringContaining('999999'),
      })
    })
  })
})
