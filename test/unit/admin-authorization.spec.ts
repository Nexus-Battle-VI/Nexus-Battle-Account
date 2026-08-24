import { AuthorizeAdminPanelAccess } from '../../src/application/use-cases/AuthorizeAdminPanelAccess'
import type { AuthenticatedPrincipal } from '../../src/application/security/AuthenticatedPrincipal'
import {
  AccessDeniedError,
  AuthenticationRequiredError,
} from '../../src/application/errors/ApplicationError'
import { InMemoryAccountRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountRepository'
import { Account } from '../../src/domain/entities/Account'
import { AccountStatus } from '../../src/domain/entities/AccountStatus'
import { Role } from '../../src/domain/entities/Role'
import { AccountId } from '../../src/domain/value-objects/AccountId'
import { DisplayName } from '../../src/domain/value-objects/DisplayName'
import { EmailAddress } from '../../src/domain/value-objects/EmailAddress'

const buildAccount = (params: {
  readonly id: string
  readonly status?: AccountStatus
  readonly roles?: readonly Role[]
}): Account =>
  Account.restore({
    id: AccountId.create(params.id),
    email: EmailAddress.create(`${params.id}@nexus.test`),
    displayName: DisplayName.create('Ana Ramirez'),
    status: params.status ?? AccountStatus.Active,
    roles: params.roles ?? [Role.Player],
  })

const buildAuthorizer = (): {
  readonly accounts: InMemoryAccountRepository
  readonly authorize: AuthorizeAdminPanelAccess
} => {
  const accounts = new InMemoryAccountRepository()

  return {
    accounts,
    authorize: new AuthorizeAdminPanelAccess(accounts),
  }
}

describe('AuthorizeAdminPanelAccess', () => {
  it('modela el principal autenticado sin roles autoritativos', () => {
    const principal = { accountId: 'acc-admin' } satisfies AuthenticatedPrincipal

    expect(principal).toEqual({ accountId: 'acc-admin' })

    const principalWithRoles: AuthenticatedPrincipal = {
      accountId: 'acc-admin',
      // @ts-expect-error El principal autenticado no acepta roles enviados por el llamador.
      roles: [Role.Administrator],
    }

    expect(principalWithRoles.accountId).toBe('acc-admin')
  })

  it('rechaza principal null', async () => {
    const { authorize } = buildAuthorizer()

    await expect(authorize.execute(null)).rejects.toBeInstanceOf(AuthenticationRequiredError)
  })

  it('rechaza principal undefined', async () => {
    const { authorize } = buildAuthorizer()

    await expect(authorize.execute(undefined)).rejects.toBeInstanceOf(AuthenticationRequiredError)
  })

  it('permite una cuenta activa con ADMINISTRATOR', async () => {
    const { accounts, authorize } = buildAuthorizer()
    await accounts.save(buildAccount({ id: 'acc-admin', roles: [Role.Player, Role.Administrator] }))

    await expect(authorize.execute({ accountId: 'acc-admin' })).resolves.toBeUndefined()
  })

  it('rechaza PLAYER', async () => {
    const { accounts, authorize } = buildAuthorizer()
    await accounts.save(buildAccount({ id: 'acc-player', roles: [Role.Player] }))

    await expect(authorize.execute({ accountId: 'acc-player' })).rejects.toBeInstanceOf(
      AccessDeniedError,
    )
  })

  it('rechaza MODERATOR', async () => {
    const { accounts, authorize } = buildAuthorizer()
    await accounts.save(buildAccount({ id: 'acc-moderator', roles: [Role.Player, Role.Moderator] }))

    await expect(authorize.execute({ accountId: 'acc-moderator' })).rejects.toBeInstanceOf(
      AccessDeniedError,
    )
  })

  it('rechaza cuenta inexistente', async () => {
    const { authorize } = buildAuthorizer()

    await expect(authorize.execute({ accountId: 'acc-missing' })).rejects.toBeInstanceOf(
      AccessDeniedError,
    )
  })

  it('rechaza principal con accountId invalido', async () => {
    const { authorize } = buildAuthorizer()

    await expect(authorize.execute({ accountId: '   ' })).rejects.toBeInstanceOf(AccessDeniedError)
  })

  it('rechaza una cuenta que actualmente no puede autenticarse', async () => {
    const { accounts, authorize } = buildAuthorizer()
    await accounts.save(
      buildAccount({
        id: 'acc-pending-admin',
        status: AccountStatus.PendingVerification,
        roles: [Role.Player, Role.Administrator],
      }),
    )

    await expect(authorize.execute({ accountId: 'acc-pending-admin' })).rejects.toBeInstanceOf(
      AccessDeniedError,
    )
  })

  it('rechaza una cuenta suspendida aunque tenga ADMINISTRATOR', async () => {
    const { accounts, authorize } = buildAuthorizer()
    await accounts.save(
      buildAccount({
        id: 'acc-suspended-admin',
        status: AccountStatus.Suspended,
        roles: [Role.Player, Role.Administrator],
      }),
    )

    await expect(authorize.execute({ accountId: 'acc-suspended-admin' })).rejects.toBeInstanceOf(
      AccessDeniedError,
    )
  })

  it('utiliza roles vigentes almacenados y no roles enviados por el llamador', async () => {
    const { accounts, authorize } = buildAuthorizer()
    await accounts.save(
      buildAccount({ id: 'acc-current-admin', roles: [Role.Player, Role.Administrator] }),
    )
    await accounts.save(buildAccount({ id: 'acc-current-player', roles: [Role.Player] }))

    const callerDowngradeAttempt = {
      accountId: 'acc-current-admin',
      roles: [Role.Player],
    }
    const callerUpgradeAttempt = {
      accountId: 'acc-current-player',
      roles: [Role.Administrator],
    }

    await expect(authorize.execute(callerDowngradeAttempt)).resolves.toBeUndefined()
    await expect(authorize.execute(callerUpgradeAttempt)).rejects.toBeInstanceOf(AccessDeniedError)
  })
})
