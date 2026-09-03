import { AccountNotFoundError } from '../../src/application/errors/ApplicationError'
import { GetOwnPersonalData } from '../../src/application/use-cases/GetOwnPersonalData'
import { InMemoryAccountRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountRepository'
import { Role } from '../../src/domain/entities/Role'
import type { Account } from '../../src/domain/entities/Account'
import type { AccountId } from '../../src/domain/value-objects/AccountId'
import { buildActiveAccount } from '../support/account-factory'

class RecordingAccountRepository extends InMemoryAccountRepository {
  readonly findBySubjectCalls: string[] = []
  readonly findByIdCalls: string[] = []

  override findBySubject(subject: string): Promise<Account | null> {
    this.findBySubjectCalls.push(subject)

    return super.findBySubject(subject)
  }

  override findById(id: AccountId): Promise<Account | null> {
    this.findByIdCalls.push(id.value)

    return super.findById(id)
  }
}

describe('GetOwnPersonalData', () => {
  const save = async (
    repository: InMemoryAccountRepository,
    overrides: Parameters<typeof buildActiveAccount>[0],
  ) => {
    const account = buildActiveAccount(overrides)
    await repository.save(account)

    return account
  }

  it('resuelve los datos personales del titular usando el subject verificado', async () => {
    const accounts = new InMemoryAccountRepository()
    await save(accounts, {
      id: 'acc-ana',
      subject: 'sub:ana@nexus.test',
      email: 'ana@nexus.test',
      displayName: 'Ana Privacy',
      roles: [Role.Player, Role.Moderator],
    })

    const result = await new GetOwnPersonalData(accounts).execute('sub:ana@nexus.test')

    expect(result).toEqual({
      email: 'ana@nexus.test',
      displayName: 'Ana Privacy',
      firstNames: 'Ana',
      lastNames: 'Ramirez',
      roles: [Role.Player, Role.Moderator],
      termsAccepted: true,
    })
  })

  it('excluye identificadores internos, estado y metadata tecnica del avatar', async () => {
    const accounts = new InMemoryAccountRepository()
    await save(accounts, {
      id: 'acc-ana',
      subject: 'sub:ana@nexus.test',
      email: 'ana@nexus.test',
    })

    const result = await new GetOwnPersonalData(accounts).execute('sub:ana@nexus.test')

    expect(Object.keys(result).sort()).toEqual([
      'displayName',
      'email',
      'firstNames',
      'lastNames',
      'roles',
      'termsAccepted',
    ])
    expect(result).not.toHaveProperty('id')
    expect(result).not.toHaveProperty('subject')
    expect(result).not.toHaveProperty('status')
    expect(result).not.toHaveProperty('avatarStorageKey')
  })

  it('falla con AccountNotFoundError cuando el subject no tiene cuenta asociada', async () => {
    const accounts = new InMemoryAccountRepository()

    await expect(new GetOwnPersonalData(accounts).execute('sub:sin-cuenta')).rejects.toBeInstanceOf(
      AccountNotFoundError,
    )
  })

  it('no muta la cuenta consultada', async () => {
    const accounts = new InMemoryAccountRepository()
    const account = await save(accounts, {
      id: 'acc-ana',
      subject: 'sub:ana@nexus.test',
      email: 'ana@nexus.test',
      roles: [Role.Player, Role.Moderator],
    })
    const before = account.toSnapshot()

    await new GetOwnPersonalData(accounts).execute('sub:ana@nexus.test')

    const stored = await accounts.findBySubject('sub:ana@nexus.test')
    expect(stored?.toSnapshot()).toEqual(before)
  })

  it('devuelve una copia de roles que no comparte arreglo con la cuenta', async () => {
    const accounts = new InMemoryAccountRepository()
    await save(accounts, {
      id: 'acc-ana',
      subject: 'sub:ana@nexus.test',
      email: 'ana@nexus.test',
      roles: [Role.Player],
    })

    const result = await new GetOwnPersonalData(accounts).execute('sub:ana@nexus.test')
    const roles = result.roles as string[]
    roles.push('ADMINISTRATOR')

    const again = await new GetOwnPersonalData(accounts).execute('sub:ana@nexus.test')
    expect(again.roles).toEqual([Role.Player])
  })

  it('usa findBySubject y no findById', async () => {
    const accounts = new RecordingAccountRepository()
    await save(accounts, {
      id: 'acc-ana',
      subject: 'sub:ana@nexus.test',
      email: 'ana@nexus.test',
    })

    await new GetOwnPersonalData(accounts).execute('sub:ana@nexus.test')

    expect(accounts.findBySubjectCalls).toEqual(['sub:ana@nexus.test'])
    expect(accounts.findByIdCalls).toEqual([])
  })

  it('resuelve cuentas diferentes para subjects diferentes', async () => {
    const accounts = new InMemoryAccountRepository()
    await save(accounts, {
      id: 'acc-ana',
      subject: 'sub:ana@nexus.test',
      email: 'ana@nexus.test',
      displayName: 'Ana Privacy',
    })
    await save(accounts, {
      id: 'acc-beatriz',
      subject: 'sub:beatriz@nexus.test',
      email: 'beatriz@nexus.test',
      displayName: 'Beatriz Privacy',
    })

    const ana = await new GetOwnPersonalData(accounts).execute('sub:ana@nexus.test')
    const beatriz = await new GetOwnPersonalData(accounts).execute('sub:beatriz@nexus.test')

    expect(ana).toMatchObject({ email: 'ana@nexus.test', displayName: 'Ana Privacy' })
    expect(beatriz).toMatchObject({ email: 'beatriz@nexus.test', displayName: 'Beatriz Privacy' })
    expect(JSON.stringify(ana)).not.toContain('beatriz@nexus.test')
    expect(JSON.stringify(beatriz)).not.toContain('ana@nexus.test')
  })
})
