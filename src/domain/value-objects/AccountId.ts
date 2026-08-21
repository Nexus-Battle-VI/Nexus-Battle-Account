import { DomainError } from '../errors/DomainError'

/**
 * Identidad de una cuenta. Se genera fuera del dominio mediante un puerto,
 * de modo que el dominio permanece determinista y verificable.
 */
export class AccountId {
  readonly value: string

  private constructor(value: string) {
    this.value = value
  }

  static create(raw: string): AccountId {
    const normalized = raw.trim()

    if (normalized.length === 0) {
      throw new DomainError('El identificador de la cuenta no puede estar vacio.')
    }

    return new AccountId(normalized)
  }

  equals(other: AccountId): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}
