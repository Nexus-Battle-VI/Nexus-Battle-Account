import { ChangeOwnPassword } from '../../src/application/use-cases/ChangeOwnPassword'
import { InMemoryPasswordChange } from '../../src/adapters/outbound/identity/InMemoryPasswordChange'
import {
  PasswordChangeError,
  type PasswordChangePort,
} from '../../src/application/ports/PasswordChangePort'

const CURRENT = 'Contrasena-Actual-Ficticia-1'
const NEW_PASSWORD = 'Contrasena-Nueva-Ficticia-1'

describe('ChangeOwnPassword', () => {
  it('cambia la contrasena cuando la actual coincide', async () => {
    const passwords = new InMemoryPasswordChange()
    passwords.seed('tok', CURRENT)

    const caso = new ChangeOwnPassword({ passwords })

    const outcome = await caso.execute({
      accessToken: 'tok',
      currentPassword: CURRENT,
      newPassword: NEW_PASSWORD,
    })

    expect(outcome).toEqual({ kind: 'changed' })
  })

  it('rechaza cuando la contrasena actual no coincide', async () => {
    const passwords = new InMemoryPasswordChange()
    passwords.seed('tok', CURRENT)

    const caso = new ChangeOwnPassword({ passwords })

    const outcome = await caso.execute({
      accessToken: 'tok',
      currentPassword: 'otra-cosa',
      newPassword: NEW_PASSWORD,
    })

    expect(outcome).toEqual({ kind: 'invalidCurrentPassword' })
  })

  it('devuelve weakPassword cuando el proveedor rechaza la contrasena nueva por politica', async () => {
    const passwords = new InMemoryPasswordChange()
    passwords.seed('tok', CURRENT)
    // El doble no decide por longitud: el test fuerza el resultado del proveedor.
    passwords.simulateWeakPassword()

    const caso = new ChangeOwnPassword({ passwords })

    const outcome = await caso.execute({
      accessToken: 'tok',
      currentPassword: CURRENT,
      newPassword: NEW_PASSWORD,
    })

    expect(outcome).toEqual({
      kind: 'weakPassword',
      reason: expect.any(String),
    })
  })

  /**
   * Un fallo del proveedor NO es un resultado esperado: se propaga para que el
   * controlador lo traduzca a 503, no a 400.
   */
  it('propaga el fallo del proveedor sin confundirlo con un rechazo de credencial', async () => {
    const providerDown: PasswordChangePort = {
      changePassword: () => Promise.reject(new PasswordChangeError('el proveedor no responde')),
    }

    const caso = new ChangeOwnPassword({ passwords: providerDown })

    await expect(
      caso.execute({ accessToken: 'tok', currentPassword: CURRENT, newPassword: NEW_PASSWORD }),
    ).rejects.toBeInstanceOf(PasswordChangeError)
  })

  it('no expone ninguna contrasena en el resultado exitoso', async () => {
    const passwords = new InMemoryPasswordChange()
    passwords.seed('tok', CURRENT)

    const outcome = await new ChangeOwnPassword({ passwords }).execute({
      accessToken: 'tok',
      currentPassword: CURRENT,
      newPassword: NEW_PASSWORD,
    })

    expect(JSON.stringify(outcome)).not.toContain(CURRENT)
    expect(JSON.stringify(outcome)).not.toContain(NEW_PASSWORD)
  })
})
