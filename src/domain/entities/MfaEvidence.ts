/**
 * Prueba de que un testimonio de acceso CONCRETO nacio de un segundo factor.
 *
 * POR QUE EXISTE. Un access token de Cognito lleva el sujeto y los grupos, pero
 * no dice como se obtuvo. Un servicio que solo lee el rol no puede distinguir un
 * testimonio emitido tras superar el segundo factor de otro emitido sin el, y
 * ante esa duda el rol administrativo basta por si solo. Esta evidencia cierra
 * esa distancia: la emite Account, que es quien presencia el segundo factor.
 *
 * LA CLAVE ES `subject` + `jti`, NO SOLO `subject`. Ligarla unicamente a la
 * persona convertiria una prueba de sesion en un atributo duradero de la cuenta:
 * un testimonio posterior, nacido sin segundo factor, heredaria la evidencia del
 * anterior. Con `jti` la prueba muere con el testimonio que la origino, que es
 * justo lo que se quiere. El metodo tambien forma parte de la comprobacion:
 * completar SMS o correo no satisface una operacion que exige TOTP mediante la
 * aplicacion autenticadora.
 *
 * LA VIGENCIA SE TOMA DEL `exp` DEL TESTIMONIO, nunca de una constante. Hoy
 * Cognito emite tokens de quince minutos, asi que codificar ese numero
 * ACERTARIA — y se desincronizaria en silencio el dia que la configuracion
 * cambie, dejando evidencias vivas mas alla del testimonio que describen.
 */
import { isSecondFactorMethod, type SecondFactorMethod } from './SecondFactorMethod'

export interface MfaEvidenceSnapshot {
  readonly subject: string
  readonly jti: string
  readonly method: SecondFactorMethod
  readonly expiresAt: Date
  readonly verifiedAt: Date
}

export class MfaEvidence {
  private constructor(
    readonly subject: string,
    readonly jti: string,
    readonly method: SecondFactorMethod,
    readonly expiresAt: Date,
    readonly verifiedAt: Date,
  ) {}

  static create(input: MfaEvidenceSnapshot): MfaEvidence {
    if (input.subject.length === 0) {
      throw new Error('La evidencia de segundo factor exige un sujeto.')
    }

    if (input.jti.length === 0) {
      throw new Error('La evidencia de segundo factor exige el identificador del testimonio.')
    }

    if (!isSecondFactorMethod(input.method)) {
      throw new Error('La evidencia de segundo factor exige un metodo reconocido.')
    }

    return new MfaEvidence(
      input.subject,
      input.jti,
      input.method,
      input.expiresAt,
      input.verifiedAt,
    )
  }

  /**
   * Vigente mientras no haya alcanzado su expiracion.
   *
   * La comparacion es estricta —`expiresAt > now`— y no `>=`: en el instante
   * exacto de la expiracion el testimonio ya no vale, y su evidencia tampoco.
   */
  isValidAt(now: Date): boolean {
    return this.expiresAt.getTime() > now.getTime()
  }

  toSnapshot(): MfaEvidenceSnapshot {
    return {
      subject: this.subject,
      jti: this.jti,
      method: this.method,
      expiresAt: this.expiresAt,
      verifiedAt: this.verifiedAt,
    }
  }
}
