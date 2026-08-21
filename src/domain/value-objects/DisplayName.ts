import { DomainError } from '../errors/DomainError'

/**
 * Nombre visible del jugador. Es distinto de la identidad tecnica: puede
 * cambiar sin que cambie la cuenta.
 */
export class DisplayName {
  static readonly MIN_LENGTH = 3
  static readonly MAX_LENGTH = 32

  private static readonly PATTERN = /^[\p{L}\p{N}](?:[\p{L}\p{N} _.-]*[\p{L}\p{N}])?$/u

  readonly value: string

  private constructor(value: string) {
    this.value = value
  }

  static create(raw: string): DisplayName {
    const normalized = raw.trim().replace(/\s+/gu, ' ')

    if (normalized.length < DisplayName.MIN_LENGTH || normalized.length > DisplayName.MAX_LENGTH) {
      throw new DomainError(
        `El nombre visible debe tener entre ${String(DisplayName.MIN_LENGTH)} y ${String(DisplayName.MAX_LENGTH)} caracteres.`,
      )
    }

    if (!DisplayName.PATTERN.test(normalized)) {
      throw new DomainError(
        `El nombre visible "${raw}" contiene caracteres no permitidos o delimitadores en los extremos.`,
      )
    }

    return new DisplayName(normalized)
  }

  equals(other: DisplayName): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}
