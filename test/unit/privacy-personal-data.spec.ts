import { InMemoryAccountRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountRepository'
import type { AccountRepositoryPort } from '../../src/application/ports/AccountRepositoryPort'
import type { AuthenticatedPrincipal } from '../../src/application/security/AuthenticatedPrincipal'
import {
  AuthenticationRequiredError,
  PersonalDataUnavailableError,
} from '../../src/application/errors/ApplicationError'
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
  id: 'acc-owner-a',
  email: 'owner-a@nexus.test',
  displayName: 'Ana Owner',
  status: AccountStatus.Active,
  roles: [Role.Player],
}

const ACCOUNT_B: AccountSeed = {
  id: 'acc-owner-b',
  email: 'owner-b@nexus.test',
  displayName: 'Bruno Owner',
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

const seedAccounts = async (
  repository: InMemoryAccountRepository,
  seeds: readonly AccountSeed[],
): Promise<void> => {
  for (const seed of seeds) {
    await repository.save(buildAccount(seed))
  }
}

const buildUseCase = async (
  seeds: readonly AccountSeed[] = [ACCOUNT_A],
): Promise<{
  readonly repository: InMemoryAccountRepository
  readonly getOwnPersonalData: GetOwnPersonalData
}> => {
  const repository = new InMemoryAccountRepository()
  await seedAccounts(repository, seeds)

  return {
    repository,
    getOwnPersonalData: new GetOwnPersonalData(repository),
  }
}

const principalOf = (seed: AccountSeed): AuthenticatedPrincipal => ({
  accountId: seed.id,
})

class FailingAccountRepository implements AccountRepositoryPort {
  constructor(private readonly failure: Error) {}

  save(): Promise<void> {
    return Promise.resolve()
  }

  findById(): Promise<Account | null> {
    return Promise.reject(this.failure)
  }

  findByEmail(): Promise<Account | null> {
    return Promise.resolve(null)
  }

  existsByEmail(): Promise<boolean> {
    return Promise.resolve(false)
  }
}

describe('GetOwnPersonalData', () => {
  it('permite que el titular autenticado consulte sus propios datos personales', async () => {
    const { getOwnPersonalData } = await buildUseCase()

    await expect(getOwnPersonalData.execute(principalOf(ACCOUNT_A))).resolves.toEqual({
      email: ACCOUNT_A.email,
      displayName: ACCOUNT_A.displayName,
    })
  })

  it('rechaza la consulta cuando no hay principal autenticado', async () => {
    const { getOwnPersonalData } = await buildUseCase()

    await expect(getOwnPersonalData.execute(null)).rejects.toBeInstanceOf(
      AuthenticationRequiredError,
    )
  })

  it('rechaza la consulta cuando el principal es undefined', async () => {
    const { getOwnPersonalData } = await buildUseCase()

    await expect(getOwnPersonalData.execute(undefined)).rejects.toBeInstanceOf(
      AuthenticationRequiredError,
    )
  })

  it('falla cerrado cuando el accountId del principal es invalido', async () => {
    const { getOwnPersonalData } = await buildUseCase()

    await expect(getOwnPersonalData.execute({ accountId: '   ' })).rejects.toBeInstanceOf(
      PersonalDataUnavailableError,
    )
  })

  it('falla cerrado cuando el principal referencia una cuenta inexistente', async () => {
    const { getOwnPersonalData } = await buildUseCase()

    await expect(
      getOwnPersonalData.execute({ accountId: 'acc-personal-data-missing' }),
    ).rejects.toBeInstanceOf(PersonalDataUnavailableError)
  })

  it('no incluye el accountId del principal en el mensaje de datos no disponibles', async () => {
    const { getOwnPersonalData } = await buildUseCase()
    const missingAccountId = 'acc-sensitive-missing'

    await expect(getOwnPersonalData.execute({ accountId: missingAccountId })).rejects.toThrow(
      PersonalDataUnavailableError,
    )
    await expect(getOwnPersonalData.execute({ accountId: missingAccountId })).rejects.not.toThrow(
      missingAccountId,
    )
  })

  it('devuelve exactamente email y displayName', async () => {
    const { getOwnPersonalData } = await buildUseCase()

    const result = await getOwnPersonalData.execute(principalOf(ACCOUNT_A))

    expect(Object.keys(result)).toEqual(['email', 'displayName'])
  })

  it('no expone id, accountId, status ni roles', async () => {
    const { getOwnPersonalData } = await buildUseCase()

    const result = await getOwnPersonalData.execute(principalOf(ACCOUNT_A))

    expect(result).not.toHaveProperty('id')
    expect(result).not.toHaveProperty('accountId')
    expect(result).not.toHaveProperty('status')
    expect(result).not.toHaveProperty('roles')
  })

  it('devuelve exclusivamente los datos del titular de cada principal', async () => {
    const { getOwnPersonalData } = await buildUseCase([ACCOUNT_A, ACCOUNT_B])

    await expect(getOwnPersonalData.execute(principalOf(ACCOUNT_A))).resolves.toEqual({
      email: ACCOUNT_A.email,
      displayName: ACCOUNT_A.displayName,
    })
    await expect(getOwnPersonalData.execute(principalOf(ACCOUNT_B))).resolves.toEqual({
      email: ACCOUNT_B.email,
      displayName: ACCOUNT_B.displayName,
    })
  })

  it('ignora un requestedAccountId adicional en runtime', async () => {
    const { getOwnPersonalData } = await buildUseCase([ACCOUNT_A, ACCOUNT_B])
    const maliciousPrincipal: AuthenticatedPrincipal & {
      readonly requestedAccountId: string
    } = {
      accountId: ACCOUNT_A.id,
      requestedAccountId: ACCOUNT_B.id,
    }

    await expect(getOwnPersonalData.execute(maliciousPrincipal)).resolves.toEqual({
      email: ACCOUNT_A.email,
      displayName: ACCOUNT_A.displayName,
    })
  })

  it('no modifica la cuenta almacenada', async () => {
    const { repository, getOwnPersonalData } = await buildUseCase([ACCOUNT_A, ACCOUNT_B])
    const before = (await repository.findById(AccountId.create(ACCOUNT_B.id)))?.toSnapshot()

    await getOwnPersonalData.execute(principalOf(ACCOUNT_B))

    const after = (await repository.findById(AccountId.create(ACCOUNT_B.id)))?.toSnapshot()
    expect(after).toEqual(before)
    expect(after?.status).toBe(ACCOUNT_B.status)
    expect(after?.roles).toEqual(ACCOUNT_B.roles)
  })

  it('propaga errores inesperados del repositorio', async () => {
    const failure = new Error('almacen no disponible')
    const getOwnPersonalData = new GetOwnPersonalData(new FailingAccountRepository(failure))

    await expect(getOwnPersonalData.execute(principalOf(ACCOUNT_A))).rejects.toBe(failure)
  })
})
