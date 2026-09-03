import type { AccountSnapshot } from '../../domain/entities/Account'

/**
 * Datos personales que el titular puede consultar en HU-45.1.
 *
 * Es un contrato distinto de AccountDto: no filtra automaticamente el snapshot
 * del agregado y excluye identificadores internos, estado y metadata tecnica.
 */
export interface OwnPersonalDataDto {
  readonly email: string
  readonly displayName: string
  readonly firstNames: string
  readonly lastNames: string
  readonly roles: readonly string[]
  readonly termsAccepted: boolean
}

export const toOwnPersonalDataDto = (snapshot: AccountSnapshot): OwnPersonalDataDto => ({
  email: snapshot.email,
  displayName: snapshot.displayName,
  firstNames: snapshot.firstNames,
  lastNames: snapshot.lastNames,
  roles: [...snapshot.roles],
  termsAccepted: snapshot.termsAccepted,
})
