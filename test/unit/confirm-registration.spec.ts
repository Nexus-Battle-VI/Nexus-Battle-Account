import { ConfirmRegistration } from '../../src/application/use-cases/ConfirmRegistration'
import { InMemoryAccountRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountRepository'
import { InMemoryIdentitySignUp } from '../../src/adapters/outbound/identity/InMemoryIdentitySignUp'
import {
  IdentitySignUpError,
  type IdentitySignUpPort,
} from '../../src/application/ports/IdentitySignUpPort'
import { AccountStatus } from '../../src/domain/entities/AccountStatus'
import { buildAccount } from '../support/account-factory'

const AT = new Date('2026-08-30T00:00:00.000Z')
const clock = { now: (): Date => AT }

const withPendingAccount = async (email = 'jugador@nexus.test') => {
  const accounts = new InMemoryAccountRepository()
  // `buildAccount` nace PENDING_VERIFICATION, que es como sale del registro.
  await accounts.saveRegistration(buildAccount({ email }), [])
  return accounts
}

describe('ConfirmRegistration', () => {
  it('confirma el codigo y activa la cuenta', async () => {
    const accounts = await withPendingAccount()
    const signUp = new InMemoryIdentitySignUp(() => 'sub-1')
    await signUp.signUp('jugador@nexus.test', 'Abcdefg1!')

    const caso = new ConfirmRegistration({ accounts, identitySignUp: signUp, clock })

    const outcome = await caso.execute({
      identifier: 'jugador@nexus.test',
      code: InMemoryIdentitySignUp.FIXED_CODE,
    })

    expect(outcome.kind).toBe('confirmed')
    const stored = await accounts.findByEmail(
      (await accounts.findByEmail(buildAccount().currentEmail))!.currentEmail,
    )
    expect(stored?.currentStatus).toBe(AccountStatus.Active)
  })

  /**
   * El control del caso anterior: un codigo equivocado NO activa la cuenta.
   * Sin esto, "confirma y activa" pasaria con una activacion incondicional.
   */
  it('un codigo invalido no activa la cuenta', async () => {
    const accounts = await withPendingAccount()
    const signUp = new InMemoryIdentitySignUp(() => 'sub-1')
    await signUp.signUp('jugador@nexus.test', 'Abcdefg1!')

    const caso = new ConfirmRegistration({ accounts, identitySignUp: signUp, clock })

    const outcome = await caso.execute({ identifier: 'jugador@nexus.test', code: '999999' })

    expect(outcome).toEqual({ kind: 'invalidCode' })
    const stored = await accounts.findByEmail(buildAccount().currentEmail)
    expect(stored?.currentStatus).toBe(AccountStatus.PendingVerification)
  })

  /**
   * Cuenta inexistente responde IGUAL que un codigo invalido, por el mismo
   * motivo que el login: no permitir enumerar cuentas por su estado.
   */
  it('una cuenta inexistente no se distingue de un codigo invalido', async () => {
    const accounts = new InMemoryAccountRepository()
    const signUp = new InMemoryIdentitySignUp(() => 'sub-1')

    const caso = new ConfirmRegistration({ accounts, identitySignUp: signUp, clock })

    const outcome = await caso.execute({ identifier: 'nadie@nexus.test', code: '000000' })

    expect(outcome).toEqual({ kind: 'invalidCode' })
  })

  it('un proveedor caido no se confunde con un codigo invalido', async () => {
    const accounts = await withPendingAccount()
    const providerDown: IdentitySignUpPort = {
      signUp: () => Promise.reject(new Error('no deberia llamarse')),
      confirmSignUp: () => Promise.reject(new IdentitySignUpError('el proveedor no responde')),
    }

    const caso = new ConfirmRegistration({ accounts, identitySignUp: providerDown, clock })

    const outcome = await caso.execute({
      identifier: 'jugador@nexus.test',
      code: InMemoryIdentitySignUp.FIXED_CODE,
    })

    expect(outcome).toEqual({ kind: 'providerUnavailable' })
  })
})
