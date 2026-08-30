import {
  type ConfirmSignUpOutcome,
  type IdentitySignUpPort,
  type SignUpOutcome,
} from '../../../application/ports/IdentitySignUpPort'

interface PendingIdentity {
  readonly subject: string
  readonly code: string
  confirmed: boolean
}

/**
 * Doble del alta para desarrollo (`AUTH_MODE=disabled`) y pruebas.
 *
 * Reproduce el contrato COMPLETO, incluida la confirmacion por codigo: si solo
 * simulara `signUp` y diera todo por confirmado, una prueba pasaria contra un
 * comportamiento que produccion no tiene. El codigo esperado es fijo y publico
 * (`000000`) a proposito: no hay correo que enviar en este entorno.
 */
export class InMemoryIdentitySignUp implements IdentitySignUpPort {
  static readonly FIXED_CODE = '000000'

  private readonly byEmail = new Map<string, PendingIdentity>()
  private readonly subjectFor: (email: string) => string

  /**
   * El sujeto se DERIVA del correo de forma determinista por defecto.
   *
   * No es un capricho: en las pruebas de integracion el token que emite el
   * verificador falso y la cuenta que crea el registro tienen que coincidir en
   * el sujeto, o `GET /me` no encontraria la cuenta. Derivarlo del correo hace
   * que coincidan sin que nadie tenga que coordinar dos valores a mano, que es
   * justo el acoplamiento que rompio el flujo cuando el sujeto venia del token.
   */
  constructor(
    subjectFor: (email: string) => string = (email) => `sub:${email.trim().toLowerCase()}`,
  ) {
    this.subjectFor = subjectFor
  }

  // La contrasena viaja en la firma para cumplir el puerto, pero el doble no
  // verifica politica de contrasena: eso es cosa del proveedor real.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- se conserva para respetar IdentitySignUpPort
  signUp(email: string, _password: string): Promise<SignUpOutcome> {
    const normalized = email.trim().toLowerCase()

    if (this.byEmail.has(normalized)) {
      return Promise.resolve({ kind: 'emailTaken' })
    }

    const subject = this.subjectFor(normalized)
    this.byEmail.set(normalized, {
      subject,
      code: InMemoryIdentitySignUp.FIXED_CODE,
      confirmed: false,
    })

    return Promise.resolve({ kind: 'created', subject })
  }

  confirmSignUp(email: string, code: string): Promise<ConfirmSignUpOutcome> {
    const pending = this.byEmail.get(email.trim().toLowerCase())

    if (pending === undefined) {
      return Promise.resolve({ kind: 'invalidCode' })
    }

    if (pending.confirmed) {
      return Promise.resolve({ kind: 'alreadyConfirmed' })
    }

    if (code !== pending.code) {
      return Promise.resolve({ kind: 'invalidCode' })
    }

    pending.confirmed = true

    return Promise.resolve({ kind: 'confirmed' })
  }
}
