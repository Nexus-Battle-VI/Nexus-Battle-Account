import { JsonAdminAccountExportAdapter } from '../../src/adapters/outbound/export/JsonAdminAccountExportAdapter'
import type { AdminAccountQueryCriteria } from '../../src/application/dto/AdminAccountQueryCriteria'
import type { AdminAccountSummaryDto } from '../../src/application/dto/AdminAccountSummaryDto'
import { ExportAdminAccounts } from '../../src/application/use-cases/ExportAdminAccounts'
import { ListAdminAccounts } from '../../src/application/use-cases/ListAdminAccounts'
import { InMemoryAccountRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountRepository'
import { Account } from '../../src/domain/entities/Account'
import { AccountStatus } from '../../src/domain/entities/AccountStatus'
import { Role } from '../../src/domain/entities/Role'
import { AccountId } from '../../src/domain/value-objects/AccountId'
import { DisplayName } from '../../src/domain/value-objects/DisplayName'
import { CountryCode } from '../../src/domain/value-objects/CountryCode'
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

const SEEDS: readonly AccountSeed[] = [
  {
    id: 'acc-export-admin',
    subject: 'subject-export-admin',
    email: 'export.admin@nexus.test',
    displayName: 'Capitana Export',
    firstNames: 'Ana Maria',
    lastNames: 'Vega',
    status: AccountStatus.Active,
    roles: [Role.Player, Role.Administrator],
    registeredAt: new Date('2026-08-20T10:00:00.000Z'),
  },
  {
    id: 'acc-export-moderator',
    subject: 'subject-export-moderator',
    email: 'export.moderator@nexus.test',
    displayName: 'Moderadora Export',
    firstNames: 'Bruno',
    lastNames: 'Rojas',
    status: AccountStatus.Suspended,
    roles: [Role.Player, Role.Moderator],
    registeredAt: new Date('2026-08-21T10:00:00.000Z'),
  },
  {
    id: 'acc-export-super',
    subject: 'subject-export-super',
    email: 'export.super@nexus.test',
    displayName: 'Raiz Export',
    firstNames: 'Sofia',
    lastNames: 'Vega',
    status: AccountStatus.Active,
    roles: [Role.SuperAdministrator],
    registeredAt: new Date('2026-08-22T10:00:00.000Z'),
  },
]

const EXPORT_FIELDS = [
  'id',
  'email',
  'displayName',
  'countryCode',
  'firstNames',
  'lastNames',
  'status',
  'roles',
  'registeredAt',
]

const buildAccount = (seed: AccountSeed): Account =>
  Account.restore({
    id: AccountId.create(seed.id),
    subject: seed.subject,
    email: EmailAddress.create(seed.email),
    displayName: DisplayName.create(seed.displayName),
    countryCode: seed.id === 'acc-export-admin' ? CountryCode.create('CO') : null,
    firstNames: PersonName.create(seed.firstNames, 'Los nombres'),
    lastNames: PersonName.create(seed.lastNames, 'Los apellidos'),
    termsAccepted: true,
    avatar: defaultAvatarMetadata(seed.id),
    status: seed.status,
    roles: seed.roles,
  })

const createHarness = async (): Promise<{
  readonly listAdminAccounts: ListAdminAccounts
  readonly exportAdminAccounts: ExportAdminAccounts
}> => {
  let nextDate = 0
  const repository = new InMemoryAccountRepository(
    () => SEEDS[nextDate++]?.registeredAt ?? new Date('2026-08-31T00:00:00.000Z'),
  )

  for (const seed of SEEDS) {
    await repository.save(buildAccount(seed))
  }

  const listAdminAccounts = new ListAdminAccounts(repository)

  return {
    listAdminAccounts,
    exportAdminAccounts: new ExportAdminAccounts(
      listAdminAccounts,
      new JsonAdminAccountExportAdapter(),
    ),
  }
}

const parseExportedAccounts = (content: string): readonly Record<string, unknown>[] => {
  const parsed = JSON.parse(content) as unknown

  if (!Array.isArray(parsed)) {
    throw new Error('La exportacion debe ser un arreglo JSON.')
  }

  return parsed as readonly Record<string, unknown>[]
}

describe('ExportAdminAccounts', () => {
  it('genera un archivo JSON determinista con media type y nombre seguros', async () => {
    const { exportAdminAccounts } = await createHarness()

    const file = await exportAdminAccounts.execute({ role: Role.Administrator })

    expect(file.filename).toBe('nexus-battles-users.json')
    expect(file.mediaType).toBe('application/json; charset=utf-8')
    expect(() => {
      JSON.parse(file.content)
    }).not.toThrow()
  })

  it('exporta exactamente los mismos usuarios que ListAdminAccounts para criterios filtrados', async () => {
    const { listAdminAccounts, exportAdminAccounts } = await createHarness()
    const criteria: AdminAccountQueryCriteria = {
      role: Role.Player,
      status: AccountStatus.Active,
      lastNames: 'vega',
    }

    const listed = await listAdminAccounts.execute(criteria)
    const file = await exportAdminAccounts.execute(criteria)
    const exported = parseExportedAccounts(file.content)

    expect(exported).toEqual(listed.items)
    expect(exported.map((account) => account.id)).toEqual(['acc-export-admin'])
  })

  it('mantiene el orden determinista del listado administrativo', async () => {
    const { listAdminAccounts, exportAdminAccounts } = await createHarness()

    const listed = await listAdminAccounts.execute()
    const file = await exportAdminAccounts.execute()

    expect(parseExportedAccounts(file.content).map((account) => account.id)).toEqual(
      listed.items.map((account) => account.id),
    )
    expect(parseExportedAccounts(file.content).map((account) => account.id)).toEqual([
      'acc-export-admin',
      'acc-export-moderator',
      'acc-export-super',
    ])
  })

  it('exporta una lista vacia como archivo JSON valido', async () => {
    const { exportAdminAccounts } = await createHarness()

    const file = await exportAdminAccounts.execute({
      role: Role.SuperAdministrator,
      status: AccountStatus.Suspended,
    })

    expect(parseExportedAccounts(file.content)).toEqual([])
  })

  it('incluye solo campos aprobados del AdminAccountSummaryDto actual', async () => {
    const { exportAdminAccounts } = await createHarness()

    const file = await exportAdminAccounts.execute({ id: 'acc-export-admin' })
    const [account] = parseExportedAccounts(file.content)

    expect(account).toBeDefined()
    expect(Object.keys(account ?? {})).toEqual(EXPORT_FIELDS)
    expect(account).toEqual({
      id: 'acc-export-admin',
      email: 'export.admin@nexus.test',
      displayName: 'Capitana Export',
      countryCode: 'CO',
      firstNames: 'Ana Maria',
      lastNames: 'Vega',
      status: AccountStatus.Active,
      roles: [Role.Player, Role.Administrator],
      registeredAt: '2026-08-20T10:00:00.000Z',
    })
  })

  it('no exporta campos sensibles ni propiedades extra presentes en runtime', async () => {
    const adapter = new JsonAdminAccountExportAdapter()
    const accountWithExtraFields: AdminAccountSummaryDto & {
      readonly subject: string
      readonly password: string
      readonly securityAnswers: readonly string[]
      readonly avatarStorageKey: string
      readonly termsAccepted: boolean
      readonly mfaSecret: string
      readonly cognitoClaims: Record<string, unknown>
    } = {
      id: 'acc-extra',
      email: 'extra@nexus.test',
      displayName: 'Extra Export',
      countryCode: null,
      firstNames: 'Extra',
      lastNames: 'Runtime',
      status: AccountStatus.Active,
      roles: [Role.Player],
      registeredAt: '2026-08-23T10:00:00.000Z',
      subject: 'subject-extra',
      password: 'no-exportar',
      securityAnswers: ['no-exportar'],
      avatarStorageKey: 'avatars/acc-extra.png',
      termsAccepted: true,
      mfaSecret: 'no-exportar',
      cognitoClaims: { sub: 'subject-extra' },
    }

    const file = await adapter.generate([accountWithExtraFields])
    const [account] = parseExportedAccounts(file.content)

    expect(Object.keys(account ?? {})).toEqual(EXPORT_FIELDS)
    expect(account).not.toHaveProperty('subject')
    expect(account).not.toHaveProperty('password')
    expect(account).not.toHaveProperty('securityAnswers')
    expect(account).not.toHaveProperty('avatarStorageKey')
    expect(account).not.toHaveProperty('termsAccepted')
    expect(account).not.toHaveProperty('mfaSecret')
    expect(account).not.toHaveProperty('cognitoClaims')
  })

  it('no muta las cuentas ni los roles al generar el archivo', async () => {
    const adapter = new JsonAdminAccountExportAdapter()
    const roles = [Role.Player, Role.Administrator]
    const account: AdminAccountSummaryDto = {
      id: 'acc-mutacion',
      email: 'mutacion@nexus.test',
      displayName: 'Mutacion Export',
      countryCode: null,
      firstNames: 'Muta',
      lastNames: 'Cion',
      status: AccountStatus.Active,
      roles,
      registeredAt: '2026-08-24T10:00:00.000Z',
    }
    const before = { ...account, roles: [...roles] }

    await adapter.generate([account])

    expect(account).toEqual(before)
    expect(account.roles).toBe(roles)
  })
})
