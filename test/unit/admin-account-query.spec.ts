import { InMemoryAccountRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountRepository'
import { ListAdminAccounts } from '../../src/application/use-cases/ListAdminAccounts'
import { Account } from '../../src/domain/entities/Account'
import { AccountStatus } from '../../src/domain/entities/AccountStatus'
import { Role } from '../../src/domain/entities/Role'
import { AccountId } from '../../src/domain/value-objects/AccountId'
import { DisplayName } from '../../src/domain/value-objects/DisplayName'
import { EmailAddress } from '../../src/domain/value-objects/EmailAddress'
import { PersonName } from '../../src/domain/value-objects/PersonName'
import { defaultAvatarMetadata } from '../support/account-factory'

interface AccountSeed {
  readonly id: string
  readonly subject: string
  readonly email: string
  readonly displayName: string
  readonly firstNames: string
  readonly lastNames: string
  readonly status: AccountStatus
  readonly roles: readonly Role[]
  readonly registeredAt: Date
}

const ADMIN_ACTIVE: AccountSeed = {
  id: 'acc-admin-active',
  subject: 'subject-admin-active',
  email: 'admin.active@nexus.test',
  displayName: 'Capitana Uno',
  firstNames: 'Ana Maria',
  lastNames: 'Vega',
  status: AccountStatus.Active,
  roles: [Role.Player, Role.Administrator],
  registeredAt: new Date('2026-08-01T10:00:00.000Z'),
}

const SEEDS: readonly AccountSeed[] = [
  ADMIN_ACTIVE,
  {
    id: 'acc-moderator-suspended',
    subject: 'subject-moderator-suspended',
    email: 'moderator.suspended@nexus.test',
    displayName: 'Moderadora Sur',
    firstNames: 'Bruno',
    lastNames: 'Rojas',
    status: AccountStatus.Suspended,
    roles: [Role.Player, Role.Moderator],
    registeredAt: new Date('2026-08-02T10:00:00.000Z'),
  },
  {
    id: 'acc-player-pending',
    subject: 'subject-player-pending',
    email: 'player.pending@nexus.test',
    displayName: 'Jugador Norte',
    firstNames: 'Camila',
    lastNames: 'Paz',
    status: AccountStatus.PendingVerification,
    roles: [Role.Player],
    registeredAt: new Date('2026-08-03T10:00:00.000Z'),
  },
  {
    id: 'acc-super-active',
    subject: 'subject-super-active',
    email: 'super.active@nexus.test',
    displayName: 'Raiz Central',
    firstNames: 'Sofia',
    lastNames: 'Vega',
    status: AccountStatus.Active,
    roles: [Role.SuperAdministrator],
    registeredAt: new Date('2026-08-04T10:00:00.000Z'),
  },
]

const buildAccount = (seed: AccountSeed): Account =>
  Account.restore({
    id: AccountId.create(seed.id),
    subject: seed.subject,
    email: EmailAddress.create(seed.email),
    displayName: DisplayName.create(seed.displayName),
    firstNames: PersonName.create(seed.firstNames, 'Los nombres'),
    lastNames: PersonName.create(seed.lastNames, 'Los apellidos'),
    termsAccepted: true,
    avatar: defaultAvatarMetadata(seed.id),
    status: seed.status,
    roles: seed.roles,
  })

const createHarness = async (): Promise<{
  readonly repository: InMemoryAccountRepository
  readonly useCase: ListAdminAccounts
}> => {
  let nextDate = 0
  const repository = new InMemoryAccountRepository(
    () => SEEDS[nextDate++]?.registeredAt ?? new Date('2026-08-31T00:00:00.000Z'),
  )

  for (const seed of SEEDS) {
    await repository.save(buildAccount(seed))
  }

  return { repository, useCase: new ListAdminAccounts(repository) }
}

describe('ListAdminAccounts', () => {
  it('lista cuentas sin filtros y calcula estadisticas de estados representables', async () => {
    const { useCase } = await createHarness()

    const result = await useCase.execute()

    expect(result.items.map((item) => item.id)).toEqual([
      'acc-admin-active',
      'acc-moderator-suspended',
      'acc-player-pending',
      'acc-super-active',
    ])
    expect(result.items[0]).toMatchObject({
      id: 'acc-admin-active',
      email: 'admin.active@nexus.test',
      displayName: 'Capitana Uno',
      firstNames: 'Ana Maria',
      lastNames: 'Vega',
      status: AccountStatus.Active,
      roles: [Role.Player, Role.Administrator],
      registeredAt: '2026-08-01T10:00:00.000Z',
    })
    expect(result.statusCounts).toEqual({
      pendingVerification: 1,
      active: 2,
      suspended: 1,
    })
    expect(result.statusCounts).not.toHaveProperty('banned')
  })

  it.each([
    ['ID', { id: ' acc-admin-active ' }, ['acc-admin-active']],
    ['correo', { email: 'ADMIN.ACTIVE@NEXUS.TEST' }, ['acc-admin-active']],
    ['nombres', { firstNames: 'ana   maria' }, ['acc-admin-active']],
    ['apellidos', { lastNames: 'vega' }, ['acc-admin-active', 'acc-super-active']],
    ['apodo', { displayName: 'raiz central' }, ['acc-super-active']],
  ])('busca por %s con normalizacion determinista', async (_field, criteria, expectedIds) => {
    const { useCase } = await createHarness()

    const result = await useCase.execute(criteria)

    expect(result.items.map((item) => item.id)).toEqual(expectedIds)
  })

  it('filtra por rol y permite SUPER_ADMINISTRATOR como rol consultable', async () => {
    const { useCase } = await createHarness()

    const result = await useCase.execute({ role: Role.SuperAdministrator })

    expect(result.items.map((item) => item.id)).toEqual(['acc-super-active'])
  })

  it('filtra por estado usando solo estados reales del dominio', async () => {
    const { useCase } = await createHarness()

    const result = await useCase.execute({ status: AccountStatus.Suspended })

    expect(result.items.map((item) => item.id)).toEqual(['acc-moderator-suspended'])
    expect(result.statusCounts).toEqual({
      pendingVerification: 0,
      active: 0,
      suspended: 1,
    })
  })

  it('combina criterios presentes con AND', async () => {
    const { useCase } = await createHarness()

    const result = await useCase.execute({
      role: Role.Player,
      status: AccountStatus.Active,
      lastNames: 'vega',
    })

    expect(result.items.map((item) => item.id)).toEqual(['acc-admin-active'])
  })

  it('devuelve una lista vacia valida cuando no hay coincidencias', async () => {
    const { useCase } = await createHarness()

    const result = await useCase.execute({
      role: Role.SuperAdministrator,
      status: AccountStatus.Suspended,
    })

    expect(result).toEqual({
      items: [],
      statusCounts: {
        pendingVerification: 0,
        active: 0,
        suspended: 0,
      },
    })
  })

  it('no observa mutaciones del agregado no guardadas ni comparte roles mutables', async () => {
    const { repository, useCase } = await createHarness()
    const account = buildAccount(ADMIN_ACTIVE)
    await repository.save(account)

    account.grantRole(Role.Moderator, new Set([Role.SuperAdministrator]))

    expect((await useCase.execute({ id: ADMIN_ACTIVE.id, role: Role.Moderator })).items).toEqual([])

    const firstRead = await useCase.execute({ id: ADMIN_ACTIVE.id })
    const roles = firstRead.items[0]?.roles as Role[]
    roles.push(Role.Moderator)

    const secondRead = await useCase.execute({ id: ADMIN_ACTIVE.id })

    expect(secondRead.items[0]?.roles).toEqual([Role.Player, Role.Administrator])
  })

  it('valida criterios mediante los value objects existentes', async () => {
    const { useCase } = await createHarness()

    await expect(useCase.execute({ email: 'no-es-correo' })).rejects.toThrow()
    await expect(useCase.execute({ displayName: '**' })).rejects.toThrow()
    await expect(useCase.execute({ firstNames: '   ' })).rejects.toThrow()
  })
})
