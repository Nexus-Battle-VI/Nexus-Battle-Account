import { CognitoJwtVerifier } from 'aws-jwt-verify'

import { isRole, type Role } from '../../../domain/entities/Role'
import {
  TokenVerificationError,
  type TokenVerifierPort,
  type VerifiedIdentity,
} from '../../../application/ports/TokenVerifierPort'

export interface CognitoTokenVerifierOptions {
  readonly userPoolId: string
  readonly clientId: string
}

/**
 * Verificador de testimonios emitidos por un user pool de Cognito.
 *
 * La comprobacion de firma la realiza `aws-jwt-verify`, que descarga y cachea
 * el JWKS del pool. No se implementa verificacion criptografica a mano: es la
 * clase de codigo donde un error sutil no falla, sino que acepta tokens
 * falsificados en silencio.
 *
 * Se verifica el token de ACCESO, no el de identidad. El de identidad describe
 * al usuario para la interfaz; el de acceso es el que autoriza una peticion, y
 * es el unico cuyo `client_id` puede comprobarse contra el cliente esperado.
 */
export class CognitoTokenVerifier implements TokenVerifierPort {
  private readonly verifier: ReturnType<typeof CognitoJwtVerifier.create>

  constructor(options: CognitoTokenVerifierOptions) {
    this.verifier = CognitoJwtVerifier.create({
      userPoolId: options.userPoolId,
      clientId: options.clientId,
      tokenUse: 'access',
    })
  }

  /**
   * Descarga el JWKS por adelantado. Sin esto, la primera peticion protegida
   * paga la latencia de red y puede agotar su tiempo de espera.
   */
  async warmUp(): Promise<void> {
    await this.verifier.hydrate()
  }

  async verify(token: string): Promise<VerifiedIdentity> {
    let payload: Awaited<ReturnType<typeof this.verifier.verify>>

    try {
      payload = await this.verifier.verify(token)
    } catch {
      // El motivo exacto no se propaga: distinguir "firma invalida" de
      // "caducado" ayuda a quien esta probando tokens falsificados.
      throw new TokenVerificationError()
    }

    return toVerifiedIdentity(payload)
  }
}

/**
 * Traduce el contenido del token a la identidad verificada.
 *
 * Es una funcion pura y exportada a proposito: es la parte del verificador que
 * decide QUE roles se aceptan, y debe poder probarse sin red y sin un pool real.
 * La comprobacion de firma, que es lo que no se debe reimplementar,
 * queda en la biblioteca.
 */
export const toVerifiedIdentity = (payload: Record<string, unknown>): VerifiedIdentity => {
  const subject = payload.sub

  // Un token sin `sub` no identifica a nadie, por muy valida que sea su firma.
  // Rellenar el hueco con cadena vacia lo dejaba pasar como identidad: dos
  // testimonios mal formados compartirian sujeto y, con el, la misma cuenta.
  // Falla como fallo de verificacion, que es lo que es, y el guard responde 401.
  if (typeof subject !== 'string' || subject.length === 0) {
    throw new TokenVerificationError()
  }

  return {
    subject,
    roles: readRoles(payload),
  }
}

/**
 * Los grupos que no corresponden a un rol conocido se descartan en silencio.
 * Aceptarlos convertiria el pool en una fuente de roles arbitrarios: bastaria
 * crear un grupo llamado como se quiera para inventar un permiso.
 */
const readRoles = (payload: Record<string, unknown>): ReadonlySet<Role> => {
  const groups = payload['cognito:groups']
  const roles = new Set<Role>()

  if (!Array.isArray(groups)) {
    return roles
  }

  for (const group of groups) {
    if (typeof group === 'string' && isRole(group)) {
      roles.add(group)
    }
  }

  return roles
}
