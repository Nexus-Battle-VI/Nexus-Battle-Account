import { DomainError } from '../errors/DomainError'

/**
 * Nombre de pila o apellidos del titular. Distinto del apodo (`DisplayName`).
 */
export class PersonName {
  readonly value: string

  private constructor(value: string) {
    this.value = value
  }

  static create(raw: string, label: string): PersonName {
    const normalized = raw.trim().replace(/\s+/gu, ' ')

    if (normalized.length === 0) {
      throw new DomainError(`${label} no puede estar vacio.`)
    }

    return new PersonName(normalized)
  }

  equals(other: PersonName): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}
