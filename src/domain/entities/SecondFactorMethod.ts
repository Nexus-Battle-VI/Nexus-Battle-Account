/**
 * Metodos de segundo factor que Account reconoce y puede demostrar.
 *
 * Vive en el dominio porque forma parte de la evidencia persistida. Los nombres
 * son propios del producto; el adaptador de Cognito traduce desde sus
 * `ChallengeName` y ningun cliente puede declarar que metodo completo.
 */
export const SecondFactorMethod = {
  AuthenticatorApp: 'AUTHENTICATOR_APP',
  Email: 'EMAIL',
  Sms: 'SMS',
} as const

export type SecondFactorMethod = (typeof SecondFactorMethod)[keyof typeof SecondFactorMethod]

export const isSecondFactorMethod = (value: unknown): value is SecondFactorMethod =>
  typeof value === 'string' &&
  (Object.values(SecondFactorMethod) as readonly string[]).includes(value)
