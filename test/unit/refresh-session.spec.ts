import { RefreshSession } from '../../src/application/use-cases/RefreshSession'
import { InMemoryAccountRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountRepository'
import {
  AuthenticationProviderError,
  type AuthenticationProviderPort,
  type RefreshOutcome,
} from '../../src/application/ports/AuthenticationProviderPort'
import {
  TokenVerificationError,
  type TokenVerifierPort,
  type VerifiedIdentity,
} from '../../src/application/ports/TokenVerifierPort'
import { Role } from '../../src/domain/entities/Role'
import { buildActiveAccount } from '../support/account-factory'

/** Doble minimo: solo `refresh` importa para este caso de uso. */
const providerReturning = (outcome: RefreshOutcome): AuthenticationProviderPort => ({
  authenticate: () => Promise.reject(new Error('no deberia llamarse')),
  verifySecondFactor: () => Promise.reject(new Error('no deberia llamarse')),
  chooseSecondFactor: () => Promise.reject(new Error('no deberia llamarse')),
  refresh: () => Promise.resolve(outcome),
})

const providerThatFails = (): AuthenticationProviderPort => ({
  authenticate: () => Promise.reject(new Error('no deberia llamarse')),
  verifySecondFactor: () => Promise.reject(new Error('no deberia llamarse')),
  chooseSecondFactor: () => Promise.reject(new Error('no deberia llamarse')),
  refresh: () => Promise.reject(new AuthenticationProviderError('caido')),
})

/** Devuelve siempre el mismo sujeto, como haria un testimonio real recien verificado. */
const verifierFor = (subject: string): TokenVerifierPort => ({
  verify: (): Promise<VerifiedIdentity> =>
    Promise.resolve({ subject, roles: new Set([Role.Player]), jti: 'jti-1', expiresAt: null }),
})

const verifierThatRejects = (): TokenVerifierPort => ({
  verify: (): Promise<VerifiedIdentity> => Promise.reject(new TokenVerificationError()),
})

describe('RefreshSession', () => {
  it('renueva la sesion cuando el testimonio de refresco y la cuenta siguen vigentes', async () => {
    const accounts = new InMemoryAccountRepository()
    const account = buildActiveAccount({ id: 'acc-1', subject: 'sujeto-1' })
    await accounts.save(account)

    const caso = new RefreshSession({
      accounts,
      authenticationProvider: providerReturning({
        kind: 'refreshed',
        accessToken: 'nuevo-access-token',
        expiresIn: 900,
      }),
      tokenVerifier: verifierFor('sujeto-1'),
    })

    const outcome = await caso.execute('refresh-token-valido')

    expect(outcome).toMatchObject({
      kind: 'refreshed',
      subject: 'sujeto-1',
      accessToken: 'nuevo-access-token',
      expiresIn: 900,
    })
  })

  it('un testimonio de refresco invalido o vencido no renueva nada', async () => {
    const accounts = new InMemoryAccountRepository()
    const caso = new RefreshSession({
      accounts,
      authenticationProvider: providerReturning({ kind: 'invalid' }),
      tokenVerifier: verifierFor('sujeto-cualquiera'),
    })

    const outcome = await caso.execute('refresh-token-vencido')

    expect(outcome).toEqual({ kind: 'invalid' })
  })

  it('un fallo del proveedor se traduce a providerUnavailable, no a invalid', async () => {
    const accounts = new InMemoryAccountRepository()
    const caso = new RefreshSession({
      accounts,
      authenticationProvider: providerThatFails(),
      tokenVerifier: verifierFor('sujeto-cualquiera'),
    })

    const outcome = await caso.execute('refresh-token-cualquiera')

    expect(outcome).toEqual({ kind: 'providerUnavailable' })
  })

  it('un access token renovado que no se puede verificar no renueva nada', async () => {
    const accounts = new InMemoryAccountRepository()
    const caso = new RefreshSession({
      accounts,
      authenticationProvider: providerReturning({
        kind: 'refreshed',
        accessToken: 'token-no-verificable',
        expiresIn: 900,
      }),
      tokenVerifier: verifierThatRejects(),
    })

    const outcome = await caso.execute('refresh-token-valido')

    expect(outcome).toEqual({ kind: 'invalid' })
  })

  it('una cuenta que ya no puede autenticar (eliminada) no renueva nada, aunque el proveedor acepte el refresco', async () => {
    const accounts = new InMemoryAccountRepository()
    // Ninguna cuenta con `sujeto-fantasma`: `findBySubject` devuelve null,
    // el mismo resultado practico que una cuenta eliminada fisicamente
    // (HU-43) cuyo `account_deletion_requests` sobrevive pero `accounts` no.
    const caso = new RefreshSession({
      accounts,
      authenticationProvider: providerReturning({
        kind: 'refreshed',
        accessToken: 'token-de-cuenta-eliminada',
        expiresIn: 900,
      }),
      tokenVerifier: verifierFor('sujeto-fantasma'),
    })

    const outcome = await caso.execute('refresh-token-de-cuenta-eliminada')

    expect(outcome).toEqual({ kind: 'invalid' })
  })
})
