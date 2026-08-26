import type { AccountDto } from './AccountDto'

/**
 * Resultado explicito del inicio de sesion (HU-02).
 *
 * Se modela como union discriminada, no como excepciones, a diferencia del
 * resto de casos de uso de este servicio. Es una eleccion deliberada para
 * ESTA operacion: fallar un login con contrasena incorrecta no es una
 * situacion excepcional -ocurre en cada intento fallido normal-, y una union
 * hace visible en un unico lugar (el `switch` de quien consume el resultado)
 * que "correo inexistente" y "contrasena incorrecta" deben producir
 * exactamente la misma rama (`invalidCredentials`), en lugar de depender de
 * que dos jerarquias de excepciones distintas terminen mapeando al mismo
 * mensaje.
 *
 * `providerUnavailable` cubre dos causas distintas a proposito: un fallo real
 * del proveedor (red, servicio caido) Y el caso en el que una cuenta
 * administrativa se autentico sin que el proveedor emitiera un reto de
 * segundo factor. Ambas comparten la misma consecuencia -no se puede
 * completar el login de forma seria- y CA-06 exige que una cuenta
 * administrativa nunca reciba `authenticated` sin segundo factor, sea cual
 * sea la causa. Ver el reporte de HU-02 para el detalle de este segundo caso:
 * es la brecha de aprovisionamiento de Cognito descrita en ADR-004.
 */
export type LoginOutcome =
  | { readonly kind: 'authenticated'; readonly account: AccountDto; readonly accessToken: string }
  | { readonly kind: 'secondFactorRequired'; readonly challengeToken: string }
  | { readonly kind: 'secondFactorInvalid' }
  | { readonly kind: 'invalidCredentials' }
  | { readonly kind: 'providerUnavailable' }
