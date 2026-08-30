import { EnrollTotp } from '../../src/application/use-cases/EnrollTotp'
import { ConfirmTotpEnrollment } from '../../src/application/use-cases/ConfirmTotpEnrollment'
import { InMemoryAccountRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountRepository'
import { InMemoryTotpEnrollment } from '../../src/adapters/outbound/identity/InMemoryTotpEnrollment'
import {
  TotpEnrollmentError,
  type TotpEnrollmentPort,
} from '../../src/application/ports/TotpEnrollmentPort'
import { buildAccount } from '../support/account-factory'

describe('EnrollTotp', () => {
  it('asocia el autenticador y etiqueta el QR con el correo de la cuenta', async () => {
    const accounts = new InMemoryAccountRepository()
    await accounts.saveRegistration(
      buildAccount({ subject: 'sub-1', email: 'admin@nexus.test' }),
      [],
    )

    const caso = new EnrollTotp({ totpEnrollment: new InMemoryTotpEnrollment(), accounts })

    const result = await caso.execute({ accessToken: 'tok', subject: 'sub-1' })

    expect(result.secret).toBe(InMemoryTotpEnrollment.FIXED_SECRET)
    expect(result.otpauthUri.startsWith('otpauth://totp/')).toBe(true)
    expect(result.otpauthUri).toContain(`secret=${InMemoryTotpEnrollment.FIXED_SECRET}`)
    // El correo, codificado para URL, viaja como etiqueta.
    expect(result.otpauthUri).toContain(encodeURIComponent('admin@nexus.test'))
  })

  /**
   * El control del caso anterior: si el sujeto no tuviera cuenta, la etiqueta
   * cae al propio sujeto en lugar de romper. La inscripcion no depende de la
   * fila de la base: actua sobre el testimonio.
   */
  it('cae al sujeto como etiqueta cuando no hay cuenta', async () => {
    const caso = new EnrollTotp({
      totpEnrollment: new InMemoryTotpEnrollment(),
      accounts: new InMemoryAccountRepository(),
    })

    const result = await caso.execute({ accessToken: 'tok', subject: 'sujeto-sin-cuenta' })

    expect(result.otpauthUri).toContain(encodeURIComponent('sujeto-sin-cuenta'))
  })
})

describe('ConfirmTotpEnrollment', () => {
  it('confirma cuando el codigo es el esperado', async () => {
    const totp = new InMemoryTotpEnrollment()
    await totp.associate('tok')

    const caso = new ConfirmTotpEnrollment({ totpEnrollment: totp })

    const outcome = await caso.execute({
      accessToken: 'tok',
      code: InMemoryTotpEnrollment.FIXED_CODE,
    })

    expect(outcome).toEqual({ kind: 'confirmed' })
  })

  it('devuelve codigo invalido cuando no coincide', async () => {
    const totp = new InMemoryTotpEnrollment()
    await totp.associate('tok')

    const caso = new ConfirmTotpEnrollment({ totpEnrollment: totp })

    const outcome = await caso.execute({ accessToken: 'tok', code: '999999' })

    expect(outcome).toEqual({ kind: 'invalidCode' })
  })

  /**
   * Un fallo del proveedor NO es un codigo invalido: se propaga para que el
   * controlador lo traduzca a 503, no a 400.
   */
  it('propaga el fallo del proveedor sin confundirlo con un codigo invalido', async () => {
    const providerDown: TotpEnrollmentPort = {
      associate: () => Promise.reject(new TotpEnrollmentError('el proveedor no responde')),
      confirm: () => Promise.reject(new TotpEnrollmentError('el proveedor no responde')),
    }

    const caso = new ConfirmTotpEnrollment({ totpEnrollment: providerDown })

    await expect(caso.execute({ accessToken: 'tok', code: '000000' })).rejects.toBeInstanceOf(
      TotpEnrollmentError,
    )
  })
})
