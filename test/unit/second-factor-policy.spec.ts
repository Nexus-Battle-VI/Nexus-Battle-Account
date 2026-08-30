import { SecondFactorPolicy } from '../../src/domain/policies/SecondFactorPolicy'
import { Role } from '../../src/domain/entities/Role'
import { SecondFactorMethod } from '../../src/application/ports/AuthenticationProviderPort'

describe('SecondFactorPolicy', () => {
  /**
   * La regla que Cognito NO puede aplicar: `mfa_configuration` es del pool
   * entero y ofrece los mismos factores a todo el mundo. Account si puede,
   * porque conoce el rol desde `account_roles`.
   */
  it.each([Role.Administrator, Role.SuperAdministrator])(
    '%s solo admite la aplicacion autenticadora',
    (role) => {
      const roles = [Role.Player, role]

      expect(SecondFactorPolicy.permits(roles, SecondFactorMethod.AuthenticatorApp)).toBe(true)
      expect(SecondFactorPolicy.permits(roles, SecondFactorMethod.Email)).toBe(false)
      expect(SecondFactorPolicy.permits(roles, SecondFactorMethod.Sms)).toBe(false)
    },
  )

  /**
   * El control del caso anterior. Si la politica rechazara el correo para
   * todos, la prueba de arriba pasaria sin distinguir el rol, que es
   * exactamente lo que tiene que distinguir.
   */
  it.each([Role.Player, Role.Moderator])('%s SI admite el correo', (role) => {
    expect(SecondFactorPolicy.permits([role], SecondFactorMethod.Email)).toBe(true)
    expect(SecondFactorPolicy.permits([role], SecondFactorMethod.AuthenticatorApp)).toBe(true)
  })

  it('recorta lo que el proveedor ofrece a lo que la cuenta puede usar', () => {
    const ofrecidos = [SecondFactorMethod.AuthenticatorApp, SecondFactorMethod.Email]

    expect(SecondFactorPolicy.narrow([Role.Player, Role.Administrator], ofrecidos)).toEqual([
      SecondFactorMethod.AuthenticatorApp,
    ])
    expect(SecondFactorPolicy.narrow([Role.Player], ofrecidos)).toEqual(ofrecidos)
  })

  /**
   * Una lista vacia es un resultado legitimo y significa algo concreto: la
   * cuenta administrativa no tiene ningun factor admisible inscrito. Quien
   * llame debe tratarlo como imposibilidad, nunca como "ofrece todo".
   */
  it('un administrador con solo correo inscrito se queda sin opciones', () => {
    expect(
      SecondFactorPolicy.narrow([Role.Player, Role.Administrator], [SecondFactorMethod.Email]),
    ).toEqual([])
  })
})
