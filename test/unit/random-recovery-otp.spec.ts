import { RandomRecoveryOtp } from '../../src/adapters/outbound/identity/RandomRecoveryOtp'

describe('RandomRecoveryOtp', () => {
  it('siempre emite un codigo de seis digitos numericos, incluido cuando hace falta relleno', () => {
    const otp = new RandomRecoveryOtp()

    // 2000 muestras sobre un rango uniforme de 0 a 999.999: la probabilidad de
    // no sortear nunca un valor que necesite relleno (por debajo de 100.000,
    // el 10% del rango) es (0.9)^2000, indistinguible de cero. Si `padStart`
    // faltara, esas muestras producirian una cadena de menos de seis digitos
    // y el patron fallaria.
    for (let i = 0; i < 2000; i += 1) {
      expect(otp.issue()).toMatch(/^\d{6}$/)
    }
  })

  it('no repite siempre el mismo codigo', () => {
    const otp = new RandomRecoveryOtp()
    const codes = new Set(Array.from({ length: 30 }, () => otp.issue()))

    // Con 30 muestras sobre 1.000.000 de valores posibles, una colision total
    // solo pasaria por un CSPRNG roto.
    expect(codes.size).toBeGreaterThan(1)
  })
})
