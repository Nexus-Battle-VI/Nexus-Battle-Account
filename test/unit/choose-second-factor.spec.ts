import { ChooseSecondFactor } from '../../src/application/use-cases/ChooseSecondFactor'
import { InMemoryAccountRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountRepository'
import {
  AuthenticationProviderError,
  SecondFactorMethod,
  type AuthenticationOutcome,
  type AuthenticationProviderPort,
} from '../../src/application/ports/AuthenticationProviderPort'
import { buildActiveAccount } from '../support/account-factory'

/**
 * Doble minimo: solo importa que `chooseSecondFactor` devuelva lo que se le
 * diga, para poder ejercitar como reacciona el caso de uso.
 */
const providerReturning = (outcome: AuthenticationOutcome): AuthenticationProviderPort => ({
  authenticate: () => Promise.reject(new Error('no deberia llamarse')),
  verifySecondFactor: () => Promise.reject(new Error('no deberia llamarse')),
  chooseSecondFactor: () => Promise.resolve(outcome),
})

const providerThatFails = (): AuthenticationProviderPort => ({
  authenticate: () => Promise.reject(new Error('no deberia llamarse')),
  verifySecondFactor: () => Promise.reject(new Error('no deberia llamarse')),
  chooseSecondFactor: () => Promise.reject(new AuthenticationProviderError('caido')),
})

const withAccount = async (): Promise<InMemoryAccountRepository> => {
  const accounts = new InMemoryAccountRepository()
  await accounts.saveRegistration(buildActiveAccount(), [])

  return accounts
}

describe('ChooseSecondFactor', () => {
  it('devuelve el reto del factor elegido, con su metodo', async () => {
    const accounts = await withAccount()
    const caso = new ChooseSecondFactor({
      accounts,
      authenticationProvider: providerReturning({
        kind: 'challengeRequired',
        challengeToken: 'reto-elegido',
        method: SecondFactorMethod.Email,
      }),
    })

    const outcome = await caso.execute({
      identifier: 'jugador@nexus.test',
      challengeToken: 'seleccion',
      method: SecondFactorMethod.Email,
    })

    expect(outcome).toEqual({
      kind: 'secondFactorRequired',
      challengeToken: 'reto-elegido',
      method: 'EMAIL',
    })
  })

  /**
   * La propiedad que hace que esta etapa NO debilite CA-06.
   *
   * Elegir factor no es autenticarse. Si el proveedor devolviera un testimonio
   * al elegir, habria autenticado sin exigir el codigo del factor recien
   * elegido, y una cuenta administrativa obtendria acceso con sola contrasena
   * mas un clic. Se falla cerrado.
   */
  it('NO entrega sesion si el proveedor autentica al elegir', async () => {
    const accounts = await withAccount()
    const caso = new ChooseSecondFactor({
      accounts,
      authenticationProvider: providerReturning({
        kind: 'authenticated',
        accessToken: 'token-que-no-deberia-existir',
        expiresIn: 3600,
      }),
    })

    const outcome = await caso.execute({
      identifier: 'jugador@nexus.test',
      challengeToken: 'seleccion',
      method: SecondFactorMethod.AuthenticatorApp,
    })

    expect(outcome).toEqual({ kind: 'providerUnavailable' })
    expect(outcome).not.toMatchObject({ kind: 'authenticated' })
  })

  it('un proveedor caido no se confunde con credenciales invalidas', async () => {
    const accounts = await withAccount()
    const caso = new ChooseSecondFactor({
      accounts,
      authenticationProvider: providerThatFails(),
    })

    await expect(
      caso.execute({
        identifier: 'jugador@nexus.test',
        challengeToken: 'seleccion',
        method: SecondFactorMethod.Email,
      }),
    ).resolves.toEqual({ kind: 'providerUnavailable' })
  })

  /**
   * Misma respuesta que una cuenta inexistente, y por el mismo motivo que en
   * `LoginAccount`: distinguirlas permitiria enumerar cuentas por su estado.
   */
  it('una cuenta que no existe responde como credenciales invalidas', async () => {
    const caso = new ChooseSecondFactor({
      accounts: new InMemoryAccountRepository(),
      authenticationProvider: providerReturning({
        kind: 'challengeRequired',
        challengeToken: 'no-deberia-llegar',
        method: SecondFactorMethod.Email,
      }),
    })

    const outcome = await caso.execute({
      identifier: 'nadie@nexus.test',
      challengeToken: 'seleccion',
      method: SecondFactorMethod.Email,
    })

    expect(outcome).toEqual({ kind: 'invalidCredentials' })
  })
})
