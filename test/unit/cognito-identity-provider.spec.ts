import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  InternalErrorException,
  ListUsersCommand,
  UserNotFoundException,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider'

import { CognitoIdentityProvider } from '../../src/adapters/outbound/identity/CognitoIdentityProvider'
import { IdentityProviderError } from '../../src/application/ports/IdentityProviderPort'

/**
 * Se intercepta `send`, igual que en `cognito-authentication-provider.spec.ts`:
 * lo que se prueba es la TRADUCCION del adaptador, no la biblioteca de AWS ni
 * la red. No hace falta pool ni credenciales.
 */
const withMockedSend = (impl: (command: unknown) => unknown): jest.SpyInstance =>
  jest
    .spyOn(CognitoIdentityProviderClient.prototype, 'send')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- el mock traduce por tipo de comando, no por la firma exacta del SDK
    .mockImplementation(impl as any)

/** Evita castear: el predicado de tipo estrecha el resultado de `find`. */
const buscar = <T>(
  comandos: readonly unknown[],
  Tipo: new (...args: never[]) => T,
): T | undefined => comandos.find((c): c is T => c instanceof Tipo)

const SUB = '94f884e8-0011-70b3-a946-c7056aa60830'

const usuarioCreado = { User: { Attributes: [{ Name: 'sub', Value: SUB }] } }

const buildProvider = (defaultGroup?: string): CognitoIdentityProvider =>
  new CognitoIdentityProvider({ userPoolId: 'us-east-1_pruebas', defaultGroup })

const error = (Constructor: new (opciones: never) => Error): Error =>
  new Constructor({ $metadata: {}, message: 'del pool' } as never)

afterEach(() => {
  jest.restoreAllMocks()
})

describe('register', () => {
  it('devuelve el sub que emite el pool, no uno inventado', async () => {
    withMockedSend((command) =>
      command instanceof AdminCreateUserCommand ? usuarioCreado : Promise.resolve({}),
    )

    await expect(
      buildProvider().register({ email: 'Jugador@Test.com ', password: 'Clave-Valida-9!' }),
    ).resolves.toEqual({ subject: SUB, email: 'jugador@test.com' })
  })

  /**
   * Las tres son decisiones explicitas del adaptador y cada una protege algo
   * distinto, asi que se comprueban por separado y no como un bloque.
   */
  describe('lo que el adaptador le pide al pool', () => {
    const capturar = (): unknown[] => {
      const comandos: unknown[] = []

      withMockedSend((command) => {
        comandos.push(command)

        return command instanceof AdminCreateUserCommand ? usuarioCreado : Promise.resolve({})
      })

      return comandos
    }

    it('no deja que Cognito envie su propio correo de invitacion', async () => {
      const comandos = capturar()
      await buildProvider().register({ email: 'a@b.com', password: 'Clave-Valida-9!' })

      expect(buscar(comandos, AdminCreateUserCommand)?.input.MessageAction).toBe('SUPPRESS')
    })

    it('no declara verificado un correo que nadie ha verificado', async () => {
      const comandos = capturar()
      await buildProvider().register({ email: 'a@b.com', password: 'Clave-Valida-9!' })

      expect(buscar(comandos, AdminCreateUserCommand)?.input.UserAttributes).toContainEqual({
        Name: 'email_verified',
        Value: 'false',
      })
    })

    it('fija la contrasena como permanente, para que el login no reciba un reto', async () => {
      const comandos = capturar()
      await buildProvider().register({ email: 'a@b.com', password: 'Clave-Valida-9!' })

      expect(buscar(comandos, AdminSetUserPasswordCommand)?.input.Permanent).toBe(true)
    })

    it('añade al grupo por defecto, del que los otros servicios leen el rol', async () => {
      const comandos = capturar()
      await buildProvider('PLAYER').register({ email: 'a@b.com', password: 'Clave-Valida-9!' })

      expect(buscar(comandos, AdminAddUserToGroupCommand)?.input.GroupName).toBe('PLAYER')
    })

    it('no toca ningun grupo si no se configura uno', async () => {
      const comandos = capturar()
      await buildProvider().register({ email: 'a@b.com', password: 'Clave-Valida-9!' })

      expect(comandos.some((c) => c instanceof AdminAddUserToGroupCommand)).toBe(false)
    })
  })

  it('traduce un correo ya registrado a un error del puerto', async () => {
    withMockedSend(() => Promise.reject(error(UsernameExistsException)))

    await expect(
      buildProvider().register({ email: 'a@b.com', password: 'Clave-Valida-9!' }),
    ).rejects.toBeInstanceOf(IdentityProviderError)
  })

  it('rechaza una contrasena vacia sin llegar a llamar al pool', async () => {
    const send = withMockedSend(() => Promise.resolve({}))

    await expect(
      buildProvider().register({ email: 'a@b.com', password: '' }),
    ).rejects.toBeInstanceOf(IdentityProviderError)
    expect(send).not.toHaveBeenCalled()
  })

  it('no acepta un usuario creado sin "sub": no identificaria a nadie', async () => {
    withMockedSend((command) =>
      command instanceof AdminCreateUserCommand
        ? { User: { Attributes: [] } }
        : Promise.resolve({}),
    )

    await expect(
      buildProvider().register({ email: 'a@b.com', password: 'Clave-Valida-9!' }),
    ).rejects.toThrow(/sin devolver su "sub"/)
  })

  /**
   * El caso que de verdad importa: el usuario YA existe en el pool cuando falla
   * el segundo paso. Dejarlo a medias produciria un usuario sin contrasena
   * utilizable que ademas ocupa el correo, de modo que ni siquiera se podria
   * reintentar el registro.
   */
  it('borra el usuario si falla despues de crearlo', async () => {
    const comandos: unknown[] = []

    withMockedSend((command) => {
      comandos.push(command)

      if (command instanceof AdminCreateUserCommand) {
        return usuarioCreado
      }

      if (command instanceof AdminSetUserPasswordCommand) {
        return Promise.reject(error(InternalErrorException))
      }

      return Promise.resolve({})
    })

    await expect(
      buildProvider().register({ email: 'a@b.com', password: 'Clave-Valida-9!' }),
    ).rejects.toBeInstanceOf(IdentityProviderError)

    expect(comandos.some((c) => c instanceof AdminDeleteUserCommand)).toBe(true)
  })
})

describe('findByEmail', () => {
  it('busca por filtro de correo, porque el usuario del pool se llama como su sub', async () => {
    const comandos: unknown[] = []

    withMockedSend((command) => {
      comandos.push(command)

      return { Users: [{ Attributes: [{ Name: 'sub', Value: SUB }] }] }
    })

    await expect(buildProvider().findByEmail(' Jugador@Test.com ')).resolves.toEqual({
      subject: SUB,
      email: 'jugador@test.com',
    })
    expect(buscar(comandos, ListUsersCommand)?.input.Filter).toBe('email = "jugador@test.com"')
  })

  it('devuelve null cuando el correo no esta en el pool', async () => {
    withMockedSend(() => ({ Users: [] }))

    await expect(buildProvider().findByEmail('a@b.com')).resolves.toBeNull()
  })

  it('rechaza un usuario sin "sub" en lugar de darlo por bueno', async () => {
    withMockedSend(() => ({ Users: [{ Attributes: [] }] }))

    await expect(buildProvider().findByEmail('a@b.com')).rejects.toThrow(/sin "sub"/)
  })
})

describe('revoke', () => {
  it('borra al sujeto', async () => {
    const comandos: unknown[] = []
    withMockedSend((command) => {
      comandos.push(command)

      return Promise.resolve({})
    })

    await buildProvider().revoke(SUB)

    expect(buscar(comandos, AdminDeleteUserCommand)?.input.Username).toBe(SUB)
  })

  /**
   * Compensar algo que ya no existe es exito, no fallo: si el usuario no esta,
   * el estado buscado ya se cumple.
   */
  it('no falla si el sujeto ya no existe', async () => {
    withMockedSend(() => Promise.reject(error(UserNotFoundException)))

    await expect(buildProvider().revoke(SUB)).resolves.toBeUndefined()
  })

  it('propaga cualquier otro fallo del pool', async () => {
    withMockedSend(() => Promise.reject(error(InternalErrorException)))

    await expect(buildProvider().revoke(SUB)).rejects.toBeInstanceOf(IdentityProviderError)
  })
})
