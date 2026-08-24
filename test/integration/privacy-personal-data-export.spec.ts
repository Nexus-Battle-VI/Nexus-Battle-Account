import { InMemoryAccountRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountRepository'
import { JsonPersonalDataExportAdapter } from '../../src/adapters/outbound/export/JsonPersonalDataExportAdapter'
import { XmlPersonalDataExportAdapter } from '../../src/adapters/outbound/export/XmlPersonalDataExportAdapter'
import type { AuthenticatedPrincipal } from '../../src/application/security/AuthenticatedPrincipal'
import { ExportPersonalData } from '../../src/application/use-cases/ExportPersonalData'
import { GetOwnPersonalData } from '../../src/application/use-cases/GetOwnPersonalData'
import { Account } from '../../src/domain/entities/Account'
import { AccountStatus } from '../../src/domain/entities/AccountStatus'
import { Role } from '../../src/domain/entities/Role'
import { AccountId } from '../../src/domain/value-objects/AccountId'
import { DisplayName } from '../../src/domain/value-objects/DisplayName'
import { EmailAddress } from '../../src/domain/value-objects/EmailAddress'

interface AccountSeed {
  readonly id: string
  readonly email: string
  readonly displayName: string
  readonly status: AccountStatus
  readonly roles: readonly Role[]
}

const ACCOUNT_A: AccountSeed = {
  id: 'acc-privacy-owner-alpha',
  email: 'owner-a@nexus.test',
  displayName: 'Owner Alpha',
  status: AccountStatus.Active,
  roles: [Role.Player],
}

const ACCOUNT_B: AccountSeed = {
  id: 'acc-privacy-owner-beta',
  email: 'owner-b@nexus.test',
  displayName: 'Owner Beta',
  status: AccountStatus.Suspended,
  roles: [Role.Player, Role.Moderator],
}

const buildAccount = (seed: AccountSeed): Account =>
  Account.restore({
    id: AccountId.create(seed.id),
    email: EmailAddress.create(seed.email),
    displayName: DisplayName.create(seed.displayName),
    status: seed.status,
    roles: seed.roles,
  })

describe('flujo tecnico de privacidad y portabilidad sin HTTP', () => {
  it('consulta datos del titular A, genera JSON/XML de A y no modifica cuentas', async () => {
    const repository = new InMemoryAccountRepository()
    await repository.save(buildAccount(ACCOUNT_A))
    await repository.save(buildAccount(ACCOUNT_B))

    const accountAId = AccountId.create(ACCOUNT_A.id)
    const accountBId = AccountId.create(ACCOUNT_B.id)
    const snapshotABefore = (await repository.findById(accountAId))?.toSnapshot()
    const snapshotBBefore = (await repository.findById(accountBId))?.toSnapshot()

    expect(snapshotABefore).toMatchObject({
      id: ACCOUNT_A.id,
      email: ACCOUNT_A.email,
      displayName: ACCOUNT_A.displayName,
    })
    expect(snapshotBBefore).toMatchObject({
      id: ACCOUNT_B.id,
      email: ACCOUNT_B.email,
      displayName: ACCOUNT_B.displayName,
    })

    const principalA: AuthenticatedPrincipal = { accountId: ACCOUNT_A.id }

    const personalData = await new GetOwnPersonalData(repository).execute(principalA)
    const jsonFile = new ExportPersonalData(new JsonPersonalDataExportAdapter()).execute(
      personalData,
    )
    const xmlFile = new ExportPersonalData(new XmlPersonalDataExportAdapter()).execute(personalData)

    expect(personalData).toEqual({
      email: ACCOUNT_A.email,
      displayName: ACCOUNT_A.displayName,
    })
    expect(personalData).not.toEqual({
      email: ACCOUNT_B.email,
      displayName: ACCOUNT_B.displayName,
    })

    const jsonPayload = JSON.parse(jsonFile.content) as Record<string, unknown>
    expect(jsonPayload).toEqual({
      email: ACCOUNT_A.email,
      displayName: ACCOUNT_A.displayName,
    })
    expect(jsonFile.content).not.toContain(ACCOUNT_B.email)
    expect(jsonFile.content).not.toContain(ACCOUNT_B.displayName)

    expect(xmlFile.content).toContain(`<email>${ACCOUNT_A.email}</email>`)
    expect(xmlFile.content).toContain(`<displayName>${ACCOUNT_A.displayName}</displayName>`)
    expect(xmlFile.content).not.toContain(ACCOUNT_B.email)
    expect(xmlFile.content).not.toContain(ACCOUNT_B.displayName)

    expect(jsonPayload.email).toBe(personalData.email)
    expect(jsonPayload.displayName).toBe(personalData.displayName)
    expect(xmlFile.content).toContain(`<email>${String(jsonPayload.email)}</email>`)
    expect(xmlFile.content).toContain(
      `<displayName>${String(jsonPayload.displayName)}</displayName>`,
    )

    expect((await repository.findById(accountAId))?.toSnapshot()).toEqual(snapshotABefore)
    expect((await repository.findById(accountBId))?.toSnapshot()).toEqual(snapshotBBefore)
  })
})
