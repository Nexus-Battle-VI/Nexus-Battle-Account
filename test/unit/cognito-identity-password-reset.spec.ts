import {
  AccessDeniedException,
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

interface RegistroFallo {
  readonly message: string
  readonly context: Record<string, unknown>
}

const registros: RegistroFallo[] = []

const loggerDoble = {
  error: (message: string, context: Record<string, unknown> = {}): void => {
    registros.push({ message, context })
  },
  info: (): void => undefined,
  warn: (): void => undefined,
  debug: (): void => undefined,
}

const buildAdapter = (): CognitoIdentityPasswordReset =>
  new CognitoIdentityPasswordReset({
    userPoolId: 'us-east-1_pruebas',
    logger: loggerDoble,
  })

beforeEach(() => {
  registros.length = 0
})

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

  /**
   * REGRESION. El adaptador descartaba el error con un `catch` a secas, lo que
   * convertia cualquier fallo en un 503 mudo. El 2026-09-02 faltaba el permiso
   * `cognito-idp:AdminSetUserPassword` en el rol del nodo y el log de Account
   * no decia nada: hubo que deducirlo simulando la politica de IAM.
   */
  it('REGISTRA el nombre del error aunque el resultado siga siendo opaco', async () => {
    withMockedSend(() => {
      throw new AccessDeniedException({ message: 'sin permiso', $metadata: {} })
    })

    const outcome = await buildAdapter().setPassword('jugador@nexus.test', 'NuevaClave9!')

    expect(outcome).toEqual({ kind: 'failed' })
    expect(registros).toHaveLength(1)
    expect(registros[0]?.message).toBe('identity_password_reset_failed')
    expect(registros[0]?.context).toEqual({ reason: 'AccessDeniedException' })
  })

  /**
   * El control del caso anterior: lo que se registra es el NOMBRE del error, y
   * nunca el correo ni la contrasena. Sin esta comprobacion, "se registra el
   * fallo" podria cumplirse volcando datos que no deben acabar en el log.
   */
  it('NUNCA registra el correo ni la contrasena', async () => {
    withMockedSend(() => {
      throw new AccessDeniedException({ message: 'sin permiso', $metadata: {} })
    })

    await buildAdapter().setPassword('jugador@nexus.test', 'NuevaClave9!')

    const volcado = JSON.stringify(registros)

    expect(volcado).not.toContain('jugador@nexus.test')
    expect(volcado).not.toContain('NuevaClave9!')
  })

  it('no registra nada cuando la operacion tiene exito', async () => {
    withMockedSend(() => ({}))

    await buildAdapter().setPassword('jugador@nexus.test', 'NuevaClave9!')

    expect(registros).toHaveLength(0)
  })
})
