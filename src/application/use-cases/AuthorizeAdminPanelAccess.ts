import { Role } from '../../domain/entities/Role'
import { AccountId } from '../../domain/value-objects/AccountId'
import type { AccountRepositoryPort } from '../ports/AccountRepositoryPort'
import type { AuthenticatedPrincipal } from '../security/AuthenticatedPrincipal'
import { AccessDeniedError, AuthenticationRequiredError } from '../errors/ApplicationError'

/**
 * Autoriza el acceso al nucleo del panel administrativo.
 *
 * El principal llega ya autenticado por una dependencia externa. Este caso de
 * uso no autentica, no interpreta tokens y no acepta roles del llamador: carga
 * la cuenta vigente y decide con su estado y roles actuales.
 *
 * HU-39 integrara el rol Super Administrador. Hasta entonces no se inventa en
 * este contexto; el unico rol elevado disponible aqui es ADMINISTRATOR.
 */
export class AuthorizeAdminPanelAccess {
  private readonly accounts: AccountRepositoryPort

  constructor(accounts: AccountRepositoryPort) {
    this.accounts = accounts
  }

  async execute(principal: AuthenticatedPrincipal | null | undefined): Promise<void> {
    if (principal === null || principal === undefined) {
      throw new AuthenticationRequiredError()
    }

    const accountId = AuthorizeAdminPanelAccess.toAccountId(principal.accountId)
    const account = await this.accounts.findById(accountId)

    if (account === null || !account.canAuthenticate || !account.hasRole(Role.Administrator)) {
      throw new AccessDeniedError()
    }
  }

  private static toAccountId(raw: string): AccountId {
    try {
      return AccountId.create(raw)
    } catch {
      throw new AccessDeniedError()
    }
  }
}
