import type {
  IdentityProviderPort,
  IdentityRegistrationInput,
  IdentitySubject,
} from '../../../application/ports/IdentityProviderPort'
import { IdentityProviderError } from '../../../application/ports/IdentityProviderPort'

/**
 * Proveedor de identidad para desarrollo y pruebas.
 *
 * Recibe la contrasena porque el contrato del puerto la exige para el alta.
 * No la almacena, no la imprime y no la registra: cuando exista Cognito, se
 * sustituye este adaptador sin tocar el dominio ni RegisterAccount.
 */
export class FakeIdentityProvider implements IdentityProviderPort {
  private readonly byEmail = new Map<string, IdentitySubject>()
  private readonly nextSubject: () => string

  constructor(nextSubject: () => string) {
    this.nextSubject = nextSubject
  }

  register(input: IdentityRegistrationInput): Promise<IdentitySubject> {
    if (input.password.length === 0) {
      return Promise.reject(new IdentityProviderError('La contrasena es obligatoria.'))
    }

    const normalized = input.email.trim().toLowerCase()

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
