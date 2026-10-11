import { AuthenticateForAppeal } from '../../src/application/use-cases/AuthenticateForAppeal'
import { InMemoryAccountRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountRepository'
import { FakeAuthenticationProvider } from '../../src/adapters/outbound/identity/FakeAuthenticationProvider'
import { HmacAppealAccessToken } from '../../src/adapters/outbound/identity/HmacAppealAccessToken'
import { AccountStatus } from '../../src/domain/entities/AccountStatus'
import { buildActiveAccount } from '../support/account-factory'

const NOW = new Date('2026-10-05T12:00:00.000Z')

const buildHarness = () => {
  const accounts = new InMemoryAccountRepository()
  let tokenCounter = 0
  const authenticationProvider = new FakeAuthenticationProvider(
    () => String((tokenCounter += 1)),
  )
  const clock = { now: (): Date => new Date(NOW) }
  const appealAccessToken = new HmacAppealAccessToken('secreto-de-prueba', clock)

  return {
    accounts,
    authenticationProvider,
    appealAccessToken,
    clock,
    authenticateForAppeal: new AuthenticateForAppeal(
      accounts,
      authenticationProvider,
      appealAccessToken,
    ),
  }
}

describe('AuthenticateForAppeal (HU-42, §6 "identidad restringida")', () => {
  it('autentica a una cuenta BANEADA y emite un token de apelacion verificable', async () => {
    const harness = buildHarness()

    const account = buildActiveAccount({
      id: 'banned-1',
      subject: 'subject-banned-1',
      email: 'banned@nexus.test',
      displayName: 'Cuenta Baneada',
    })
    account.ban()
    await harness.accounts.save(account)
    harness.authenticationProvider.seed({ email: 'banned@nexus.test', password: 'Secreta123!' })

    const outcome = await harness.authenticateForAppeal.execute({
      identifier: 'banned@nexus.test',
      password: 'Secreta123!',
    })

    expect(outcome.kind).toBe('appealAuthenticated')

    if (outcome.kind !== 'appealAuthenticated') throw new Error('unreachable')

    const verified = harness.appealAccessToken.verify(outcome.appealToken)
    expect(verified).toEqual({ accountId: 'banned-1', subject: 'subject-banned-1' })
  })

  it('autentica a una cuenta SUSPENDIDA de la misma forma', async () => {
    const harness = buildHarness()

    const account = buildActiveAccount({
      id: 'suspended-1',
      subject: 'subject-suspended-1',
      email: 'suspended@nexus.test',
      displayName: 'Cuenta Suspendida',
    })
    account.suspend()
    await harness.accounts.save(account)
    harness.authenticationProvider.seed({ email: 'suspended@nexus.test', password: 'Secreta123!' })

    const outcome = await harness.authenticateForAppeal.execute({
      identifier: 'suspended@nexus.test',
      password: 'Secreta123!',
    })

    expect(outcome.kind).toBe('appealAuthenticated')

    const stored = await harness.accounts.findBySubject('subject-suspended-1')
    expect(stored?.currentStatus).toBe(AccountStatus.Suspended)
  })

  it('rechaza una contrasena incorrecta', async () => {
    const harness = buildHarness()

    const account = buildActiveAccount({
      id: 'banned-2',
      subject: 'subject-banned-2',
      email: 'banned2@nexus.test',
      displayName: 'Cuenta Baneada',
    })
    account.ban()
    await harness.accounts.save(account)
    harness.authenticationProvider.seed({ email: 'banned2@nexus.test', password: 'Secreta123!' })

    const outcome = await harness.authenticateForAppeal.execute({
      identifier: 'banned2@nexus.test',
      password: 'incorrecta',
    })

    expect(outcome.kind).toBe('invalidCredentials')
  })

  it('rechaza una identidad inexistente sin distinguirlo de una contrasena incorrecta', async () => {
    const harness = buildHarness()

    const outcome = await harness.authenticateForAppeal.execute({
      identifier: 'no-existe@nexus.test',
      password: 'cualquiera',
    })

    expect(outcome.kind).toBe('invalidCredentials')
  })

  it('declara la limitacion cuando el proveedor exige segundo factor', async () => {
    const harness = buildHarness()

    const account = buildActiveAccount({
      id: 'admin-banned-1',
      subject: 'subject-admin-banned-1',
      email: 'admin.banned@nexus.test',
      displayName: 'Admin Baneado',
    })
    account.ban()
    await harness.accounts.save(account)
    harness.authenticationProvider.seed({
      email: 'admin.banned@nexus.test',
      password: 'Secreta123!',
      requiresSecondFactor: true,
    })

    const outcome = await harness.authenticateForAppeal.execute({
      identifier: 'admin.banned@nexus.test',
      password: 'Secreta123!',
    })

    expect(outcome.kind).toBe('secondFactorNotSupportedForAppeal')
  })
})

describe('HmacAppealAccessToken', () => {
  it('rechaza un token vencido', () => {
    let now = NOW
    const clock = { now: (): Date => now }
    const token = new HmacAppealAccessToken('secreto', clock)

    const issued = token.issue({ accountId: 'a-1', subject: 's-1' }, 60)

    now = new Date(NOW.getTime() + 61_000)
    expect(token.verify(issued)).toBeNull()
  })

  it('rechaza un token firmado con otro secreto', () => {
    const clock = { now: (): Date => NOW }
    const issuer = new HmacAppealAccessToken('secreto-a', clock)
    const verifier = new HmacAppealAccessToken('secreto-b', clock)

    const issued = issuer.issue({ accountId: 'a-1', subject: 's-1' }, 60)
    expect(verifier.verify(issued)).toBeNull()
  })

  it('rechaza un token manipulado', () => {
    const clock = { now: (): Date => NOW }
    const token = new HmacAppealAccessToken('secreto', clock)

    const issued = token.issue({ accountId: 'a-1', subject: 's-1' }, 60)
    expect(token.verify(`${issued}x`)).toBeNull()
  })

  it('rechaza un token con formato invalido', () => {
    const clock = { now: (): Date => NOW }
    const token = new HmacAppealAccessToken('secreto', clock)

    expect(token.verify('no-es-un-token')).toBeNull()
    expect(token.verify('')).toBeNull()
  })
})
