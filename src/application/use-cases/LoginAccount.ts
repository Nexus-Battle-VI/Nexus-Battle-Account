import { isAdministrativeRole } from '../../domain/entities/Role'
import { SecondFactorPolicy } from '../../domain/policies/SecondFactorPolicy'
import type { AccountRepositoryPort } from '../ports/AccountRepositoryPort'
import {
  AuthenticationProviderError,
  type AuthenticationProviderPort,
} from '../ports/AuthenticationProviderPort'
import { toAccountDto } from '../dto/AccountDto'
import type { LoginOutcome } from '../dto/LoginResult'
import { resolveAccountByIdentifier } from './AccountIdentifierResolver'

export interface LoginAccountCommand {
  /** Correo electronico o apodo (HU-02, CA-01 / CA-02). Nunca incluye un rol. */
  readonly identifier: string
  readonly password: string
}

export interface LoginAccountDependencies {
  readonly accounts: AccountRepositoryPort
  readonly authenticationProvider: AuthenticationProviderPort
}

/**
 * Primera etapa del inicio de sesion (HU-02): credenciales -> identidad + rol.
 *
 * No asigna ni consulta el rol para elegirlo: lo LEE de la cuenta ya
 * persistida (`account.currentRoles`), que es la fuente de verdad de RBAC en
 * este servicio (docs/architecture.md). El cliente no puede influir en el rol
 * resultante porque nunca se lee nada del cuerpo de la peticion para eso: el
 * contrato HTTP ni siquiera declara un campo `role` (whitelist + non
 * whitelisted -> 400 si lo envia).
 *
 * Para Administrator/SuperAdministrator, una contrasena correcta NUNCA basta
 * (CA-06): si el proveedor entrega un token directamente para una de esas
 * cuentas, sin haber retado el segundo factor, este caso de uso lo trata como
 * `providerUnavailable` en lugar de `authenticated`. No es un exito
 * silencioso: es la senal de que el mecanismo de segundo factor no esta
 * aplicandose para esa cuenta, que es exactamente el estado que CA-06
 * prohibe dejar pasar. Ver el reporte de HU-02 para el blocker de
 * Infrastructure asociado.
 */
export class LoginAccount {
  private readonly deps: LoginAccountDependencies

  constructor(deps: LoginAccountDependencies) {
    this.deps = deps
  }

  async execute(command: LoginAccountCommand): Promise<LoginOutcome> {
    const account = await resolveAccountByIdentifier(this.deps.accounts, command.identifier)

    // Cuenta inexistente y cuenta que no puede autenticarse (pendiente de
    // verificacion o suspendida) responden IGUAL que una contrasena
    // incorrecta. Distinguirlas permitiria enumerar cuentas por su estado,
    // no solo por su existencia.
    if (!account?.canAuthenticate) {
      return { kind: 'invalidCredentials' }
    }

    let outcome: Awaited<ReturnType<AuthenticationProviderPort['authenticate']>>

    try {
      outcome = await this.deps.authenticationProvider.authenticate({
        email: account.currentEmail.value,
        password: command.password,
      })
    } catch (error: unknown) {
      if (error instanceof AuthenticationProviderError) {
        return { kind: 'providerUnavailable' }
      }

      throw error
    }

    if (outcome.kind === 'invalidCredentials') {
      return { kind: 'invalidCredentials' }
    }

    if (outcome.kind === 'challengeRequired') {
      /**
       * El proveedor no distingue por rol; Account si.
       *
       * Un administrador cuyo segundo factor sea el correo tendria el factor
       * colgando del mismo buzon que sirve para recuperar la cuenta. Se
       * rechaza aqui, que es el unico sitio donde se conoce el rol y donde la
       * fuente de verdad es `account_roles` y no el testimonio.
       */
      if (!SecondFactorPolicy.permits(account.currentRoles, outcome.method)) {
        return { kind: 'secondFactorNotPermitted' }
      }

      return {
        kind: 'secondFactorRequired',
        challengeToken: outcome.challengeToken,
        method: outcome.method,
      }
    }

    /**
     * Elegir factor es un reto tan valido como responderlo.
     *
     * Va ANTES de la comprobacion administrativa a proposito: `selectionRequired`
     * significa que el proveedor SI esta exigiendo segundo factor, solo que
     * todavia no ha decidido cual. Tratarlo como "no hubo reto" convertiria en
     * fallo el caso normal de una cuenta con dos factores inscritos.
     */
    if (outcome.kind === 'selectionRequired') {
      // Se ofrece SOLO lo que la politica permite. Mostrar un factor que
      // despues se rechazaria seria invitar a elegir un camino sin salida.
      const permitidos = SecondFactorPolicy.narrow(account.currentRoles, outcome.methods)

      if (permitidos.length === 0) {
        return { kind: 'secondFactorNotPermitted' }
      }

      return {
        kind: 'secondFactorSelectionRequired',
        challengeToken: outcome.challengeToken,
        methods: permitidos,
      }
    }

    if (isAdministrativeRole(account.currentRoles)) {
      return { kind: 'providerUnavailable' }
    }

    return {
      kind: 'authenticated',
      account: toAccountDto(account.toSnapshot()),
      subject: account.subject,
      accessToken: outcome.accessToken,
      expiresIn: outcome.expiresIn,
    }
  }
}
