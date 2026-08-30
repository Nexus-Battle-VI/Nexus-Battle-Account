import { InMemoryMfaStatus } from '../../src/adapters/outbound/identity/InMemoryMfaStatus'
import { InMemoryRoleDirectory } from '../../src/adapters/outbound/identity/InMemoryRoleDirectory'
import { InMemorySessionRevocation } from '../../src/adapters/outbound/identity/InMemorySessionRevocation'
import { InMemoryAccountRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountRepository'
import { AccountNotFoundError } from '../../src/application/errors/ApplicationError'
import {
  RoleDirectoryError,
  type RoleDirectoryPort,
} from '../../src/application/ports/RoleDirectoryPort'
import { AssignRole } from '../../src/application/use-cases/AssignRole'
import { FindAccountByEmail } from '../../src/application/use-cases/FindAccountByEmail'
import { RevokeRole } from '../../src/application/use-cases/RevokeRole'
import { Role } from '../../src/domain/entities/Role'
import { DomainError } from '../../src/domain/errors/DomainError'
import { AccountId } from '../../src/domain/value-objects/AccountId'
import { buildActiveAccount } from '../support/account-factory'

interface Harness {
  readonly accounts: InMemoryAccountRepository
  readonly directory: InMemoryRoleDirectory
  readonly mfa: InMemoryMfaStatus
  readonly sessions: InMemorySessionRevocation
  readonly assignRole: AssignRole
  readonly revokeRole: RevokeRole
  readonly findByEmail: FindAccountByEmail
}

const buildHarness = async (): Promise<Harness> => {
  const accounts = new InMemoryAccountRepository()
  const directory = new InMemoryRoleDirectory()
  const mfa = new InMemoryMfaStatus()
  const sessions = new InMemorySessionRevocation()

  await accounts.save(
    buildActiveAccount({
      id: 'super',
      subject: 'subject-super',
      email: 'super@nexus.test',
      roles: [Role.Player, Role.SuperAdministrator],
    }),
  )
  await accounts.save(
    buildActiveAccount({
      id: 'target',
      subject: 'subject-target',
      email: 'target@nexus.test',
    }),
  )

  return {
    accounts,
    directory,
    mfa,
    sessions,
    assignRole: new AssignRole(accounts, directory, mfa),
    revokeRole: new RevokeRole(accounts, directory, sessions),
    findByEmail: new FindAccountByEmail(accounts, mfa),
  }
}

const command = (role: Role) => ({
  actorSubject: 'subject-super',
  targetAccountId: 'target',
  role,
})

describe('AssignRole', () => {
  it('concede MODERATOR, persiste la fuente de verdad y refleja el conjunto', async () => {
    const harness = await buildHarness()

    await expect(harness.assignRole.execute(command(Role.Moderator))).resolves.toMatchObject({
      kind: 'assigned',
      account: { roles: [Role.Player, Role.Moderator] },
    })

    expect((await harness.accounts.findById(AccountId.create('target')))?.currentRoles).toEqual([
      Role.Player,
      Role.Moderator,
    ])
    expect(harness.directory.rolesOf('subject-target')).toEqual([Role.Player, Role.Moderator])
  })

  it('solo concede ADMINISTRATOR cuando Cognito confirma TOTP', async () => {
    const harness = await buildHarness()
    const save = jest.spyOn(harness.accounts, 'save')
    const reflect = jest.spyOn(harness.directory, 'reflect')

    await expect(harness.assignRole.execute(command(Role.Administrator))).resolves.toEqual({
      kind: 'mfaRequired',
    })
    expect(save).not.toHaveBeenCalled()
    expect(reflect).not.toHaveBeenCalled()

    harness.mfa.confirm('subject-target')
    await expect(harness.assignRole.execute(command(Role.Administrator))).resolves.toMatchObject({
      kind: 'assigned',
    })
  })

  it('rechaza SUPER_ADMINISTRATOR y a un ADMINISTRATOR como actor', async () => {
    const harness = await buildHarness()

    await expect(harness.assignRole.execute(command(Role.SuperAdministrator))).rejects.toThrow(
      /no se concede mediante la API/,
    )

    await harness.accounts.save(
      buildActiveAccount({
        id: 'admin',
        subject: 'subject-admin',
        email: 'admin@nexus.test',
        roles: [Role.Player, Role.Administrator],
      }),
    )

    await expect(
      harness.assignRole.execute({
        actorSubject: 'subject-admin',
        targetAccountId: 'target',
        role: Role.Moderator,
      }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('es idempotente si el rol ya existe', async () => {
    const harness = await buildHarness()
    await harness.assignRole.execute(command(Role.Moderator))
    const save = jest.spyOn(harness.accounts, 'save')
    const reflect = jest.spyOn(harness.directory, 'reflect')

    await expect(harness.assignRole.execute(command(Role.Moderator))).resolves.toMatchObject({
      kind: 'assigned',
    })
    expect(save).not.toHaveBeenCalled()
    expect(reflect).not.toHaveBeenCalled()
  })

  it('la idempotencia de ADMINISTRATOR no vuelve a exigir TOTP ni escribe', async () => {
    const harness = await buildHarness()
    harness.mfa.confirm('subject-target')
    await harness.assignRole.execute(command(Role.Administrator))
    const save = jest.spyOn(harness.accounts, 'save')
    const reflect = jest.spyOn(harness.directory, 'reflect')
    const statusWithoutTotp = new InMemoryMfaStatus()

    await expect(
      new AssignRole(harness.accounts, harness.directory, statusWithoutTotp).execute(
        command(Role.Administrator),
      ),
    ).resolves.toMatchObject({ kind: 'assigned' })
    expect(save).not.toHaveBeenCalled()
    expect(reflect).not.toHaveBeenCalled()
  })

  it('conserva el rol en PostgreSQL si falla el reflejo al conceder', async () => {
    const harness = await buildHarness()
    const unavailable: RoleDirectoryPort = {
      reflect: () => Promise.reject(new RoleDirectoryError('Cognito no responde')),
    }
    const useCase = new AssignRole(harness.accounts, unavailable, harness.mfa)

    await expect(useCase.execute(command(Role.Moderator))).rejects.toBeInstanceOf(
      RoleDirectoryError,
    )
    expect((await harness.accounts.findById(AccountId.create('target')))?.currentRoles).toContain(
      Role.Moderator,
    )
  })

  it('responde con cuenta inexistente sin escribir', async () => {
    const harness = await buildHarness()

    await expect(
      harness.assignRole.execute({ ...command(Role.Moderator), targetAccountId: 'missing' }),
    ).rejects.toBeInstanceOf(AccountNotFoundError)
  })
})

describe('RevokeRole', () => {
  it('refleja, persiste y cierra sesiones en ese orden', async () => {
    const harness = await buildHarness()
    await harness.assignRole.execute(command(Role.Moderator))
    const events: string[] = []
    const baseReflect = harness.directory.reflect.bind(harness.directory)
    const baseSave = harness.accounts.save.bind(harness.accounts)
    const baseSignOut = harness.sessions.globalSignOut.bind(harness.sessions)

    jest.spyOn(harness.directory, 'reflect').mockImplementation(async (subject, roles) => {
      events.push('reflect')
      await baseReflect(subject, roles)
    })
    jest.spyOn(harness.accounts, 'save').mockImplementation(async (account) => {
      events.push('save')
      await baseSave(account)
    })
    jest.spyOn(harness.sessions, 'globalSignOut').mockImplementation(async (subject) => {
      events.push('signOut')
      await baseSignOut(subject)
    })

    await harness.revokeRole.execute(command(Role.Moderator))

    expect(events).toEqual(['reflect', 'save', 'signOut'])
    expect(harness.directory.rolesOf('subject-target')).toEqual([Role.Player])
    expect(harness.sessions.wasSignedOut('subject-target')).toBe(true)
  })

  it('no modifica PostgreSQL si falla el reflejo al retirar', async () => {
    const harness = await buildHarness()
    await harness.assignRole.execute(command(Role.Moderator))
    const save = jest.spyOn(harness.accounts, 'save')
    const unavailable: RoleDirectoryPort = {
      reflect: () => Promise.reject(new RoleDirectoryError('Cognito no responde')),
    }
    const useCase = new RevokeRole(harness.accounts, unavailable, harness.sessions)

    await expect(useCase.execute(command(Role.Moderator))).rejects.toBeInstanceOf(
      RoleDirectoryError,
    )
    expect(save).not.toHaveBeenCalled()
    expect((await harness.accounts.findById(AccountId.create('target')))?.currentRoles).toContain(
      Role.Moderator,
    )
  })

  it('rechaza retirar PLAYER y el propio SUPER_ADMINISTRATOR', async () => {
    const harness = await buildHarness()

    await expect(harness.revokeRole.execute(command(Role.Player))).rejects.toThrow(
      /minimo de toda cuenta/,
    )
    await expect(
      harness.revokeRole.execute({
        actorSubject: 'subject-super',
        targetAccountId: 'super',
        role: Role.SuperAdministrator,
      }),
    ).rejects.toThrow(/propio rol raiz/)
  })
})

describe('FindAccountByEmail', () => {
  it('devuelve datos de gestion y el estado TOTP confirmado', async () => {
    const harness = await buildHarness()
    harness.mfa.confirm('subject-target')

    await expect(harness.findByEmail.execute(' TARGET@NEXUS.TEST ')).resolves.toMatchObject({
      id: 'target',
      email: 'target@nexus.test',
      roles: [Role.Player],
      mfaEnrolled: true,
    })
  })
})
