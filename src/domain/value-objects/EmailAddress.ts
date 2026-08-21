import { DomainError } from '../errors/DomainError'

/**
 * Direccion de correo validada. Es el identificador natural de una cuenta.
 */
export class EmailAddress {
  static readonly MAX_LENGTH = 254

  private static readonly PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/

  readonly value: string

  private constructor(value: string) {
    this.value = value
  }

  static create(raw: string): EmailAddress {
    const normalized = raw.trim().toLowerCase()

    if (normalized.length === 0) {
      throw new DomainError('La direccion de correo no puede estar vacia.')
    }

    if (normalized.length > EmailAddress.MAX_LENGTH) {
      throw new DomainError(
        `La direccion de correo supera ${String(EmailAddress.MAX_LENGTH)} caracteres.`,
      )
    }

    if (!EmailAddress.PATTERN.test(normalized)) {
      throw new DomainError(`La direccion de correo "${raw}" no tiene un formato valido.`)
    }

    return new EmailAddress(normalized)
  }

  equals(other: EmailAddress): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}
