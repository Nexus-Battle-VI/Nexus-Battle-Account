import type { VerifiedEmailDirectoryPort } from '../../../application/ports/VerifiedEmailDirectoryPort'

/**
 * Doble en memoria del directorio de correos verificados.
 *
 * Un sujeto no sembrado no tiene correo verificado. Esa respuesta cerrada es
 * tambien la adecuada cuando el proveedor esta deshabilitado en desarrollo.
 */
export class InMemoryVerifiedEmailDirectory implements VerifiedEmailDirectoryPort {
  private readonly verifiedEmails = new Map<string, string>()

  findVerifiedEmail(subject: string): Promise<string | null> {
    return Promise.resolve(this.verifiedEmails.get(subject) ?? null)
  }

  setVerifiedEmail(subject: string, email: string): void {
    this.verifiedEmails.set(subject, email)
  }

  removeVerifiedEmail(subject: string): void {
    this.verifiedEmails.delete(subject)
  }
}
