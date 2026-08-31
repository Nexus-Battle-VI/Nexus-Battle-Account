import { LogoutAccount } from '../../src/application/use-cases/LogoutAccount'
import { InMemorySessionRevocation } from '../../src/adapters/outbound/identity/InMemorySessionRevocation'
import {
  SessionRevocationError,
  type SessionRevocationPort,
} from '../../src/application/ports/SessionRevocationPort'

describe('LogoutAccount (HU-03)', () => {
  it('solicita la invalidacion global de la sesion del sujeto en el proveedor', async () => {
    const sessionRevocation = new InMemorySessionRevocation()
    const useCase = new LogoutAccount(sessionRevocation)

    await useCase.execute({ subject: 'sujeto-jugador-123' })

    expect(sessionRevocation.wasSignedOut('sujeto-jugador-123')).toBe(true)
    expect(sessionRevocation.wasSignedOut('otro-sujeto')).toBe(false)
  })

  it('propaga SessionRevocationError cuando el proveedor de identidad falla', async () => {
    const failingRevocation: SessionRevocationPort = {
      globalSignOut: () => Promise.reject(new SessionRevocationError('Fallo de red en Cognito')),
    }
    const useCase = new LogoutAccount(failingRevocation)

    await expect(useCase.execute({ subject: 'sujeto-jugador-123' })).rejects.toThrow(
      SessionRevocationError,
    )
  })
})
