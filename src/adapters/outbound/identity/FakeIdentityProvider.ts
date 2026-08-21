import type {
  IdentityProviderPort,
  IdentitySubject,
} from '../../../application/ports/IdentityProviderPort'
import { IdentityProviderError } from '../../../application/ports/IdentityProviderPort'

/**
 * Proveedor de identidad para desarrollo y pruebas.
 *
 * No es una prueba falsa: implementa el contrato completo del puerto sobre
 * almacenamiento en memoria. Es el adaptador por defecto mientras no exista un
 * proveedor de identidad autorizado, que es un blocker declarado del proyecto.
 *
 * No almacena, deriva ni verifica contrasenas. Ese es precisamente el motivo de
 * que el puerto exista: cuando se apruebe un proveedor real, se sustituye este
 * adaptador sin tocar el dominio ni los casos de uso.
 */
export class FakeIdentityProvider implements IdentityProviderPort {
  private readonly byEmail = new Map<string, IdentitySubject>()
  private readonly nextSubject: () => string

  constructor(nextSubject: () => string) {
    this.nextSubject = nextSubject
  }

  register(email: string): Promise<IdentitySubject> {
    const normalized = email.trim().toLowerCase()

    if (this.byEmail.has(normalized)) {
      return Promise.reject(
        new IdentityProviderError(`El correo "${normalized}" ya tiene un sujeto registrado.`),
      )
    }

    const subject: IdentitySubject = { subject: this.nextSubject(), email: normalized }
    this.byEmail.set(normalized, subject)

    return Promise.resolve(subject)
  }

  findByEmail(email: string): Promise<IdentitySubject | null> {
    return Promise.resolve(this.byEmail.get(email.trim().toLowerCase()) ?? null)
  }

  revoke(subject: string): Promise<void> {
    for (const [email, stored] of this.byEmail) {
      if (stored.subject === subject) {
        this.byEmail.delete(email)
        break
      }
    }

    return Promise.resolve()
  }

  get size(): number {
    return this.byEmail.size
  }
}
