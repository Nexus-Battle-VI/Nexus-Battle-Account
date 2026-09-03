import type { AccountSnapshot } from '../../domain/entities/Account'

/**
 * Representacion de una cuenta hacia el exterior de la aplicacion.
 *
 * Es intencionadamente igual a la instantanea del agregado en este alcance,
 * pero se declara aparte para que un cambio interno del dominio no se filtre
 * automaticamente al contrato publico.
 */
export interface AccountDto {
  readonly id: string
  readonly email: string
  readonly displayName: string
  readonly countryCode: string | null
  readonly firstNames: string
  readonly lastNames: string
  readonly status: string
  readonly roles: readonly string[]
}

export const toAccountDto = (snapshot: AccountSnapshot): AccountDto => ({
  id: snapshot.id,
  email: snapshot.email,
  displayName: snapshot.displayName,
  countryCode: snapshot.countryCode,
  firstNames: snapshot.firstNames,
  lastNames: snapshot.lastNames,
  status: snapshot.status,
  roles: [...snapshot.roles],
})
