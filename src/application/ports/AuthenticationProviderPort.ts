/**
 * Puerto de verificacion de credenciales (HU-02).
 *
 * Deliberadamente SEPARADO de `IdentityProviderPort`, y no una extension suya.
 * Las razones:
 *
 * 1. `IdentityProviderPort` documenta su alcance como "alta, consulta y baja
 *    del sujeto" (gestion del ciclo de vida). Autenticar -demostrar que una
 *    contrasena corresponde a un sujeto- es una operacion distinta, con una
 *    forma de resultado mas rica (exito / reto de segundo factor / rechazo) y
 *    una superficie real de proveedor distinta (Cognito `InitiateAuth` /
 *    `RespondToAuthChallenge` frente a `AdminCreateUser` / `AdminGetUser`).
 *    Fusionarlas obligaria a quien solo necesita registrar (RegisterAccount) a
 *    depender de un contrato mas ancho del que usa.
 * 2. Hay precedente directo en este mismo servicio: `TokenVerifierPort` ya se
 *    separo de `IdentityProviderPort` por el mismo motivo (verificar un
 *    testimonio ya emitido es una responsabilidad distinta de darlo de alta).
 *    Este puerto sigue el mismo patron para "demostrar la contrasena", en
 *    lugar de introducir una forma nueva de dividir responsabilidades.
 *
 * La contrasena atraviesa este puerto en claro porque el proveedor externo la
 * necesita para comprobarla (igual que `IdentityRegistrationInput` en el alta,
 * HU-01). Ningun adaptador de este puerto debe persistirla, registrarla en
 * logs, devolverla ni incluirla en eventos o telemetria.
 *
 * El puerto NO emite tokens propios: `accessToken` es el testimonio que el
 * proveedor de identidad firmo (Cognito). Vease ADR-004: Account no se
 * convierte en un segundo emisor de JWT. Ese token se verifica despues con el
 * `TokenVerifierPort` ya existente, exactamente como cualquier otra peticion
 * protegida.
 */

export interface AuthenticationCredentials {
  readonly email: string
  readonly password: string
}

/**
 * Resultado de la primera etapa (usuario + contrasena).
 *
 * `challengeRequired` modela el segundo factor de forma agnostica al
 * transporte: el proveedor decide si reta o no, y con que mecanismo. HU-02
 * pide correo; el ADR-004 vigente en Infrastructure tiene aprovisionado TOTP
 * porque el correo exige SES, todavia no decidido. Este puerto no asume
 * ninguno de los dos: solo transporta el reto tal como el proveedor lo emite.
 */
export type AuthenticationOutcome =
  | { readonly kind: 'authenticated'; readonly accessToken: string }
  | { readonly kind: 'challengeRequired'; readonly challengeToken: string }
  | { readonly kind: 'invalidCredentials' }

export interface SecondFactorVerification {
  readonly email: string
  readonly challengeToken: string
  readonly code: string
}

export type SecondFactorOutcome =
  | { readonly kind: 'verified'; readonly accessToken: string }
  | { readonly kind: 'invalidCode' }
  | { readonly kind: 'challengeExpired' }

export interface AuthenticationProviderPort {
  /** Primera etapa: usuario y contrasena. */
  authenticate(credentials: AuthenticationCredentials): Promise<AuthenticationOutcome>

  /** Segunda etapa: completa un reto de segundo factor pendiente. */
  verifySecondFactor(input: SecondFactorVerification): Promise<SecondFactorOutcome>
}

/**
 * Fallo INESPERADO del proveedor (red, servicio caido). No es lo mismo que
 * `invalidCredentials`: esto significa que no se pudo completar la
 * comprobacion, no que la comprobacion fallo. La capa de aplicacion lo traduce
 * a "error temporal del proveedor", nunca a "credenciales invalidas".
 */
export class AuthenticationProviderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthenticationProviderError'
  }
}

export const AUTHENTICATION_PROVIDER = Symbol('AuthenticationProviderPort')
