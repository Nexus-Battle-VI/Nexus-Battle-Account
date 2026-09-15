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
import { InMemorySanctionRepository } from '../../src/adapters/outbound/persistence/InMemorySanctionRepository'
import { Sanction } from '../../src/domain/entities/Sanction'
import { SanctionType } from '../../src/domain/entities/SanctionType'
import { InvalidAdminAccountQueryError } from '../../src/application/errors/ApplicationError'

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
  {
    id: 'acc-player-banned',
    subject: 'subject-player-banned',
    email: 'player.banned@nexus.test',
    displayName: 'Jugador Baneado',
    firstNames: 'Diego',
    lastNames: 'Torres',
    status: AccountStatus.Banned,
    roles: [Role.Player],
    registeredAt: new Date('2026-08-05T10:00:00.000Z'),
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
  readonly sanctions: InMemorySanctionRepository
  readonly useCase: ListAdminAccounts
}> => {
  let nextDate = 0
  const sanctions = new InMemorySanctionRepository()

  const repository = new InMemoryAccountRepository(
    () => SEEDS[nextDate++]?.registeredAt ?? new Date('2026-08-31T00:00:00.000Z'),
    sanctions,
  )

  for (const seed of SEEDS) {
    await repository.save(buildAccount(seed))
  }

  return {
    repository,
    sanctions,
    useCase: new ListAdminAccounts(repository),
  }
}

describe('ListAdminAccounts', () => {
  const seedSanctions = async (sanctions: InMemorySanctionRepository): Promise<void> => {
    for (const [id, targetAccountId, type] of [
      ['warning', 'acc-admin-active', SanctionType.Warning],
      ['another-warning', 'acc-admin-active', SanctionType.Warning],
      ['expired', 'acc-moderator-suspended', SanctionType.TemporarySuspension],
      ['ban', 'acc-player-banned', SanctionType.PermanentBan],
      ['deleted', 'acc-deleted', SanctionType.Warning],
    ] as const) {
      await sanctions.save(
        Sanction.create({
          id,
          targetAccountId,
          actorAccountId: 'acc-super-active',
          type,
          reason: 'Causal sintetica HU-44.2',
          createdAt: new Date('2020-01-01T00:00:00.000Z'),
          expiresAt:
            type === SanctionType.TemporarySuspension ? new Date('2020-01-02T00:00:00.000Z') : null,
        }),
      )
    }
  }

  it.each([
    [true, ['acc-admin-active', 'acc-moderator-suspended', 'acc-player-banned']],
    [false, ['acc-player-pending', 'acc-super-active']],
  ])(
    'filtra historial recibido %s sin duplicados ni confundir actor con sancionado',
    async (hasSanctionHistory, ids) => {
      const { useCase, sanctions } = await createHarness()
      await seedSanctions(sanctions)
      expect((await useCase.execute({ hasSanctionHistory })).items.map((item) => item.id)).toEqual(
        ids,
      )
    },
  )

  it.each([
    [{ firstNames: 'ana maria', role: Role.Administrator }, ['acc-admin-active']],
    [{ lastNames: 'vega', status: AccountStatus.Active }, ['acc-admin-active', 'acc-super-active']],
    [{ role: Role.Moderator, status: AccountStatus.Suspended }, ['acc-moderator-suspended']],
    [{ displayName: 'capitana uno', hasSanctionHistory: true }, ['acc-admin-active']],
    [{ role: Role.Moderator, hasSanctionHistory: true }, ['acc-moderator-suspended']],
    [{ status: AccountStatus.Banned, hasSanctionHistory: true }, ['acc-player-banned']],
    [{ role: Role.SuperAdministrator, hasSanctionHistory: false }, ['acc-super-active']],
    [
      {
        email: 'ADMIN.ACTIVE@NEXUS.TEST',
        role: Role.Player,
        status: AccountStatus.Active,
        hasSanctionHistory: true,
      },
      ['acc-admin-active'],
    ],
    [{ email: 'ADMIN.ACTIVE@NEXUS.TEST', hasSanctionHistory: false }, []],
  ])('combina los criterios %j mediante AND', async (criteria, ids) => {
    const { useCase, sanctions } = await createHarness()
    await seedSanctions(sanctions)
    expect((await useCase.execute(criteria)).items.map((item) => item.id)).toEqual(ids)
  })

  it('consulta historial sin modificar snapshots, metadatos o sanciones', async () => {
    const { useCase, sanctions, repository } = await createHarness()
    await seedSanctions(sanctions)
    const readSnapshots = () =>
      Promise.all(
        SEEDS.map(async (seed) =>
          (await repository.findById(AccountId.create(seed.id)))?.toSnapshot(),
        ),
      )
    const before = await readSnapshots()
    const summaries = await useCase.execute()
    const history = structuredClone(sanctions.findAll().map((sanction) => sanction.toSnapshot()))
    await useCase.execute({ hasSanctionHistory: true })
    await useCase.execute({ hasSanctionHistory: false, role: Role.Player })
    expect(await readSnapshots()).toEqual(before)
    expect(await useCase.execute()).toEqual(summaries)
    expect(sanctions.findAll().map((sanction) => sanction.toSnapshot())).toEqual(history)
  })

  it('consulta en lote solo IDs candidatos y devuelve un subconjunto sin duplicados', async () => {
    const { sanctions } = await createHarness()
    await seedSanctions(sanctions)
    expect(await sanctions.findAccountIdsWithHistory([])).toEqual([])
    expect(
      await sanctions.findAccountIdsWithHistory([
        'acc-admin-active',
        'acc-admin-active',
        'acc-super-active',
      ]),
    ).toEqual(['acc-admin-active'])
  })

  it('no interpreta la falta de la fuente de sanciones como historial vacio', async () => {
    const repository = new InMemoryAccountRepository()
    await repository.save(buildAccount(ADMIN_ACTIVE))
    await expect(repository.query({ hasSanctionHistory: false })).rejects.toThrow(
      'repositorio de sanciones',
    )
  })

  it('sin sanciones persistidas distingue true, false y criterio omitido', async () => {
    const { useCase } = await createHarness()
    expect((await useCase.execute({ hasSanctionHistory: true })).items).toEqual([])
    expect(await useCase.execute({ hasSanctionHistory: false })).toEqual(await useCase.execute())
  })
  it.each([
    [
      'solo desde',
      { registeredFrom: new Date('2026-08-03T10:00:00Z') },
      ['acc-player-banned', 'acc-player-pending', 'acc-super-active'],
    ],
    [
      'solo hasta',
      { registeredTo: new Date('2026-08-02T10:00:00Z') },
      ['acc-admin-active', 'acc-moderator-suspended'],
    ],
    [
      'rango inclusivo',
      {
        registeredFrom: new Date('2026-08-01T10:00:00Z'),
        registeredTo: new Date('2026-08-02T10:00:00Z'),
      },
      ['acc-admin-active', 'acc-moderator-suspended'],
    ],
    [
      'limites iguales',
      {
        registeredFrom: new Date('2026-08-02T10:00:00Z'),
        registeredTo: new Date('2026-08-02T10:00:00Z'),
      },
      ['acc-moderator-suspended'],
    ],
    [
      'excluye por debajo',
      { registeredFrom: new Date('2026-08-04T10:00:00.001Z') },
      ['acc-player-banned'],
    ],
    [
      'excluye por encima',
      { registeredTo: new Date('2026-08-02T09:59:59.999Z') },
      ['acc-admin-active'],
    ],
    [
      'sin resultados',
      {
        registeredFrom: new Date('2027-01-01T00:00:00Z'),
        registeredTo: new Date('2027-02-01T00:00:00Z'),
      },
      [],
    ],
    [
      'busqueda',
      { registeredFrom: new Date('2026-08-02T10:00:00Z'), lastNames: 'vega' },
      ['acc-super-active'],
    ],
    [
      'rol',
      { registeredTo: new Date('2026-08-02T10:00:00Z'), role: Role.Moderator },
      ['acc-moderator-suspended'],
    ],
    [
      'estado',
      { registeredFrom: new Date('2026-08-02T10:00:00Z'), status: AccountStatus.Active },
      ['acc-super-active'],
    ],
    [
      'historial',
      { registeredFrom: new Date('2026-08-03T10:00:00Z'), hasSanctionHistory: true },
      ['acc-player-banned'],
    ],
    [
      'multiples criterios AND',
      {
        registeredFrom: new Date('2026-08-01T10:00:00Z'),
        registeredTo: new Date('2026-08-03T10:00:00Z'),
        displayName: 'moderadora sur',
        role: Role.Moderator,
        status: AccountStatus.Suspended,
        hasSanctionHistory: true,
      },
      ['acc-moderator-suspended'],
    ],
    [
      'fecha excluye otros criterios',
      {
        registeredFrom: new Date('2026-08-02T10:00:00Z'),
        role: Role.Administrator,
        hasSanctionHistory: true,
      },
      [],
    ],
  ])('filtra por fecha: %s', async (_case, criteria, ids) => {
    const { useCase, sanctions } = await createHarness()
    await seedSanctions(sanctions)
    const before = await useCase.execute()
    const history = structuredClone(sanctions.findAll().map((sanction) => sanction.toSnapshot()))
    expect((await useCase.execute(criteria)).items.map((item) => item.id)).toEqual(ids)
    expect(await useCase.execute()).toEqual(before)
    expect(sanctions.findAll().map((sanction) => sanction.toSnapshot())).toEqual(history)
  })

  it.each([
    { registeredFrom: new Date('invalida') },
    { registeredTo: new Date('invalida') },
    {
      registeredFrom: new Date('2026-08-03T00:00:00Z'),
      registeredTo: new Date('2026-08-02T00:00:00Z'),
    },
  ])('rechaza fechas invalidas o rango invertido tambien fuera de HTTP: %j', async (criteria) => {
    const { useCase } = await createHarness()
    await expect(useCase.execute(criteria)).rejects.toBeInstanceOf(InvalidAdminAccountQueryError)
  })

  it('copia los limites para no observar cambios del llamador durante una consulta asincrona', async () => {
    const { useCase, sanctions } = await createHarness()
    await seedSanctions(sanctions)
    const registeredFrom = new Date('2026-08-01T10:00:00Z')
    const registeredTo = new Date('2026-08-01T10:00:00Z')
    const query = useCase.execute({ registeredFrom, registeredTo, hasSanctionHistory: true })
    registeredFrom.setUTCFullYear(2030)
    registeredTo.setUTCFullYear(2030)
    expect((await query).items.map((item) => item.id)).toEqual(['acc-admin-active'])
  })

  it.each(['save', 'saveRegistration'] as const)(
    'conserva la fecha del primer %s al avanzar el reloj, actualizar y consultar',
    async (method) => {
      const clock = new Date('2026-08-01T10:23:45.678Z')
      const registeredAt = clock.toISOString()
      const repository = new InMemoryAccountRepository(() => clock)
      const account = buildAccount(ADMIN_ACTIVE)
      await repository[method](account, [])

      // El reloj entrega la misma referencia mutable; el repositorio debe copiarla.
      clock.setTime(Date.parse('2026-09-05T16:00:00.000Z'))
      const useCase = new ListAdminAccounts(repository)
      expect((await useCase.execute({ id: account.id.value })).items[0]?.registeredAt).toBe(
        registeredAt,
      )

      account.rename(DisplayName.create('Capitana Actualizada'))
      await repository.save(account)
      const before = account.toSnapshot()
      clock.setTime(Date.parse('2026-09-06T16:00:00.000Z'))

      const listed = await useCase.execute({ id: account.id.value })
      expect(listed.items[0]).toMatchObject({
        displayName: 'Capitana Actualizada',
        registeredAt,
      })
      expect(await useCase.execute({ id: account.id.value })).toEqual(listed)
      expect((await repository.findById(account.id))?.toSnapshot()).toEqual(before)
    },
  )

  it('lista cuentas sin filtros y calcula estadisticas de estados representables', async () => {
    const { useCase } = await createHarness()

    const result = await useCase.execute()

    expect(result.items.map((item) => item.id)).toEqual([
      'acc-admin-active',
      'acc-moderator-suspended',
      'acc-player-banned',
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
      banned: 1,
    })
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

  it.each([
    [
      Role.Player,
      ['acc-admin-active', 'acc-moderator-suspended', 'acc-player-banned', 'acc-player-pending'],
    ],
    [Role.Moderator, ['acc-moderator-suspended']],
    [Role.Administrator, ['acc-admin-active']],
    [Role.SuperAdministrator, ['acc-super-active']],
  ])('filtra por rol %s', async (role, expectedIds) => {
    const { useCase } = await createHarness()

    const result = await useCase.execute({ role })

    expect(result.items.map((item) => item.id)).toEqual(expectedIds)
  })

  it.each([
    [
      AccountStatus.PendingVerification,
      ['acc-player-pending'],
      {
        pendingVerification: 1,
        active: 0,
        suspended: 0,
        banned: 0,
      },
    ],
    [
      AccountStatus.Active,
      ['acc-admin-active', 'acc-super-active'],
      {
        pendingVerification: 0,
        active: 2,
        suspended: 0,
        banned: 0,
      },
    ],
    [
      AccountStatus.Suspended,
      ['acc-moderator-suspended'],
      {
        pendingVerification: 0,
        active: 0,
        suspended: 1,
        banned: 0,
      },
    ],
    [
      AccountStatus.Banned,
      ['acc-player-banned'],
      {
        pendingVerification: 0,
        active: 0,
        suspended: 0,
        banned: 1,
      },
    ],
  ])('filtra por estado real %s', async (status, expectedIds, expectedCounts) => {
    const { useCase } = await createHarness()

    const result = await useCase.execute({ status })

    expect(result.items.map((item) => item.id)).toEqual(expectedIds)
    expect(result.statusCounts).toEqual(expectedCounts)
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
        banned: 0,
      },
    })
  })

  it.each([
    ['ID', { id: 'acc-inexistente' }],
    ['correo', { email: 'nadie@nexus.test' }],
    ['nombres', { firstNames: 'Nombre Inexistente' }],
    ['apellidos', { lastNames: 'Apellido Inexistente' }],
    ['apodo', { displayName: 'Apodo Inexistente' }],
  ])(
    'devuelve vacio cuando la busqueda por %s no tiene coincidencias',
    async (_field, criteria) => {
      const { useCase } = await createHarness()

      const result = await useCase.execute(criteria)

      expect(result).toEqual({
        items: [],
        statusCounts: {
          pendingVerification: 0,
          active: 0,
          suspended: 0,
          banned: 0,
        },
      })
    },
  )

  it('consultar no muta campos administrativos ni roles', async () => {
    const { useCase } = await createHarness()
    const before = await useCase.execute()

    await useCase.execute({ email: 'ADMIN.ACTIVE@NEXUS.TEST' })
    await useCase.execute({ firstNames: 'ana   maria' })
    await useCase.execute({ role: Role.Player, status: AccountStatus.Active })

    const after = await useCase.execute()

    expect(after).toEqual(before)
  })

  it('no observa mutaciones del agregado no guardadas ni comparte roles mutables', async () => {
    const { repository, useCase } = await createHarness()

    const account = buildAccount(ADMIN_ACTIVE)
    await repository.save(account)

    account.grantRole(Role.Moderator, new Set([Role.SuperAdministrator]))

    expect(
      (
        await useCase.execute({
          id: ADMIN_ACTIVE.id,
          role: Role.Moderator,
        })
      ).items,
    ).toEqual([])

    const firstRead = await useCase.execute({ id: ADMIN_ACTIVE.id })
    const roles = firstRead.items[0]?.roles as Role[]
    roles.push(Role.Moderator)

    const secondRead = await useCase.execute({ id: ADMIN_ACTIVE.id })

    expect(secondRead.items[0]?.roles).toEqual([Role.Player, Role.Administrator])
  })

  it('valida criterios mediante los value objects existentes', async () => {
    const { useCase } = await createHarness()

    await expect(
      useCase.execute({
        email: 'no-es-correo',
      }),
    ).rejects.toThrow()

    await expect(
      useCase.execute({
        displayName: '**',
      }),
    ).rejects.toThrow()

    await expect(
      useCase.execute({
        firstNames: '   ',
      }),
    ).rejects.toThrow()
  })
})
