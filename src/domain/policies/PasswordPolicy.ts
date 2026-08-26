import { DomainError } from '../errors/DomainError'

/**
 * Politica de contrasena del registro (HU-01).
 *
 * La contrasena se valida aqui y se entrega al proveedor de identidad. El
 * agregado Account no la almacena.
 *
 * El documento del cliente exige mas de ocho caracteres: 8 es invalido y 9 es
 * el primer tamano admisible.
 */
export const PasswordPolicy = {
  MIN_LENGTH: 9,

  assertValid(password: string): void {
    if (password.length < PasswordPolicy.MIN_LENGTH) {
      throw new DomainError(
        `La contrasena debe tener mas de 8 caracteres (minimo ${String(PasswordPolicy.MIN_LENGTH)}).`,
      )
    }

    if (!/\p{Lu}/u.test(password)) {
      throw new DomainError('La contrasena debe contener al menos una mayuscula.')
    }

    if (!/\p{Ll}/u.test(password)) {
      throw new DomainError('La contrasena debe contener al menos una minuscula.')
    }

    if (!/\p{N}/u.test(password)) {
      throw new DomainError('La contrasena debe contener al menos un numero.')
    }

    if (!/[^\p{L}\p{N}]/u.test(password)) {
      throw new DomainError('La contrasena debe contener al menos un simbolo.')
    }
  },
} as const
