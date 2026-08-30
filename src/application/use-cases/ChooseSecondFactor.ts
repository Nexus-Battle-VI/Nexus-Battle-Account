import { resolveAccountByIdentifier } from './AccountIdentifierResolver'
import { SecondFactorPolicy } from '../../domain/policies/SecondFactorPolicy'
import {
  AuthenticationProviderError,
  type AuthenticationProviderPort,
  type SecondFactorMethod,
} from '../ports/AuthenticationProviderPort'
import type { AccountRepositoryPort } from '../ports/AccountRepositoryPort'
import type { LoginOutcome } from '../dto/LoginResult'

export interface ChooseSecondFactorCommand {
  readonly identifier: string
  readonly challengeToken: string
  readonly method: SecondFactorMethod
}

export interface ChooseSecondFactorDependencies {
  readonly accounts: AccountRepositoryPort
  readonly authenticationProvider: AuthenticationProviderPort
}

/**
 * Etapa intermedia cuando el proveedor ofrece VARIOS segundos factores.
 *
 * Existe porque `SELECT_MFA_TYPE` no es "ingresa un codigo": todavia no hay
 * codigo. Antes de este caso de uso, el adaptador lo trataba como fallo del
 * proveedor -y hacia bien, porque fingir que el formulario de codigo lo
 * resuelve seria inventar un flujo-, de modo que **activar un segundo factor
 * adicional habria roto el inicio de sesion por credenciales** con un 503.
 *
 * Elegir NO autentica y NO entrega testimonio: devuelve el reto del factor
 * elegido, que sigue habiendo que responder. Es la propiedad que hace que esta
 * etapa no debilite CA-06: una cuenta administrativa que llegue aqui sigue sin
 * poder hacer nada hasta completar el codigo.
 */
export class ChooseSecondFactor {
  private readonly deps: ChooseSecondFactorDependencies

  constructor(deps: ChooseSecondFactorDependencies) {
    this.deps = deps
  }

  async execute(command: ChooseSecondFactorCommand): Promise<LoginOutcome> {
    const account = await resolveAccountByIdentifier(this.deps.accounts, command.identifier)

    // Misma respuesta que una cuenta inexistente o no autenticable, y por el
    // mismo motivo que en `LoginAccount`: distinguirlas permitiria enumerar
    // cuentas por su estado.
    if (!account?.canAuthenticate) {
      return { kind: 'invalidCredentials' }
    }

    /**
     * Se comprueba ANTES de llamar al proveedor.
     *
     * `LoginAccount` ya recorta lo que se ofrece, pero esta ruta es publica y
     * recibe el metodo del cuerpo de la peticion: sin esto, bastaria con
     * llamarla a mano pidiendo EMAIL para saltarse la politica. Filtrar solo en
     * la pantalla seria seguridad aparente.
     */
    if (!SecondFactorPolicy.permits(account.currentRoles, command.method)) {
      return { kind: 'secondFactorNotPermitted' }
    }

    let outcome: Awaited<ReturnType<AuthenticationProviderPort['chooseSecondFactor']>>

    try {
      outcome = await this.deps.authenticationProvider.chooseSecondFactor({
        email: account.currentEmail.value,
        challengeToken: command.challengeToken,
        method: command.method,
      })
    } catch (error: unknown) {
      if (error instanceof AuthenticationProviderError) {
        return { kind: 'providerUnavailable' }
      }

      throw error
    }

    if (outcome.kind === 'challengeRequired') {
      return {
        kind: 'secondFactorRequired',
        challengeToken: outcome.challengeToken,
        method: outcome.method,
      }
    }

    if (outcome.kind === 'selectionRequired') {
      return {
        kind: 'secondFactorSelectionRequired',
        challengeToken: outcome.challengeToken,
        methods: outcome.methods,
      }
    }

    if (outcome.kind === 'invalidCredentials') {
      return { kind: 'invalidCredentials' }
    }

    /**
     * Elegir factor NUNCA debe entregar un testimonio.
     *
     * Si el proveedor lo hiciera, habria autenticado sin exigir el codigo del
     * factor que se acaba de elegir. Se falla cerrado: es la misma regla que
     * `LoginAccount` aplica cuando un rol administrativo recibe token sin reto.
     */
    return { kind: 'providerUnavailable' }
  }
}
