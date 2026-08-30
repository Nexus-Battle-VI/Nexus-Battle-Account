import { ChooseSecondFactor } from '../../src/application/use-cases/ChooseSecondFactor'
import { InMemoryAccountRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountRepository'
import {
  AuthenticationProviderError,
  SecondFactorMethod,
  type AuthenticationOutcome,
  type AuthenticationProviderPort,
} from '../../src/application/ports/AuthenticationProviderPort'
import { buildActiveAccount } from '../support/account-factory'
import { Role } from '../../src/domain/entities/Role'

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
  /**
   * LA prueba de esta tanda.
   *
   * `LoginAccount` ya recorta lo que se OFRECE, pero esta ruta es publica y
   * recibe el metodo del cuerpo de la peticion. Si la politica se aplicara solo
   * al construir la pantalla, bastaria con llamar al endpoint a mano pidiendo
   * EMAIL para que un administrador se saltara la exigencia de autenticador.
   *
   * Eso es exactamente lo que este proyecto llama seguridad aparente: filtrar
   * en la interfaz no es un control.
   *
   * El doble del proveedor falla si se le llama: parte de lo que se comprueba
   * es que NO se llegue a Cognito.
   */
  it('un administrador NO puede elegir el correo llamando al endpoint a mano', async () => {
    const accounts = new InMemoryAccountRepository()
    await accounts.saveRegistration(
      buildActiveAccount({ roles: [Role.Player, Role.Administrator] }),
      [],
    )

    const caso = new ChooseSecondFactor({
      accounts,
      authenticationProvider: {
        authenticate: () => Promise.reject(new Error('no deberia llamarse')),
        verifySecondFactor: () => Promise.reject(new Error('no deberia llamarse')),
        chooseSecondFactor: () => Promise.reject(new Error('NO debe llegar al proveedor')),
      },
    })

    const outcome = await caso.execute({
      identifier: 'jugador@nexus.test',
      challengeToken: 'seleccion',
      method: SecondFactorMethod.Email,
    })

    expect(outcome).toEqual({ kind: 'secondFactorNotPermitted' })
  })

  /**
   * El control del anterior: el mismo endpoint, la misma llamada, y un jugador
   * SI puede elegir el correo. Sin esto, una politica que rechazara siempre el
   * correo pasaria la prueba de arriba sin distinguir nada.
   */
  it('un jugador SI puede elegir el correo por la misma ruta', async () => {
    const accounts = await withAccount()
    const caso = new ChooseSecondFactor({
      accounts,
      authenticationProvider: providerReturning({
        kind: 'challengeRequired',
        challengeToken: 'reto-correo',
        method: SecondFactorMethod.Email,
      }),
    })

    const outcome = await caso.execute({
      identifier: 'jugador@nexus.test',
      challengeToken: 'seleccion',
      method: SecondFactorMethod.Email,
    })

    expect(outcome).toMatchObject({ kind: 'secondFactorRequired', method: 'EMAIL' })
  })

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
