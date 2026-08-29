import type { Role } from '../../../domain/entities/Role'
import type { RoleDirectoryPort } from '../../../application/ports/RoleDirectoryPort'

/**
 * Implementacion en memoria de `RoleDirectoryPort`.
 *
 * No simula el comportamiento: lo implementa. Guarda de verdad la pertenencia y
 * la sustituye entera en cada reflejo, que es lo mismo que el adaptador de
 * Cognito consigue calculando la diferencia. Por eso una prueba que use este
 * doble comprueba el contrato, no una imitacion suya.
 *
 * Se usa cuando no hay proveedor configurado (`AUTH_MODE=disabled`). Ahi no hay
 * ningun pool donde reflejar nada, y **decirlo es mejor que fallar**: sin
 * proveedor tampoco hay testimonios, de modo que no existe la divergencia que
 * el reflejo evita.
 */
export class InMemoryRoleDirectory implements RoleDirectoryPort {
  private readonly membership = new Map<string, ReadonlySet<Role>>()

  reflect(subject: string, roles: readonly Role[]): Promise<void> {
    this.membership.set(subject, new Set(roles))

    return Promise.resolve()
  }

  /** Solo para pruebas: que roles quedaron reflejados para un sujeto. */
  rolesOf(subject: string): readonly Role[] {
    return [...(this.membership.get(subject) ?? [])]
  }
}
