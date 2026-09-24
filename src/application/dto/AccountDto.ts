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
  /** `es` | `en` | `fr` | `pt`, o `null` si la persona no eligio idioma. */
  readonly preferredLanguage: string | null
  readonly firstNames: string
  readonly lastNames: string
  readonly status: string
  readonly roles: readonly string[]
  /**
   * Ruta del propio Account que resuelve el avatar (ver `GetAccountAvatar`),
   * nunca la clave de almacenamiento cruda ni una URL suministrada por un
   * cliente. `null` para una cuenta sin avatar recuperable -hoy el registro lo
   * exige siempre, pero el campo se declara opcional para no asumir que esa
   * regla es permanente-.
   */
  readonly avatarUrl: string | null
}

/** Ruta HTTP que sirve el avatar de una cuenta. Unico lugar que la construye. */
export const buildAvatarUrl = (accountId: string): string => `/accounts/${accountId}/avatar`

export const toAccountDto = (snapshot: AccountSnapshot): AccountDto => ({
  id: snapshot.id,
  email: snapshot.email,
  displayName: snapshot.displayName,
  countryCode: snapshot.countryCode,
  preferredLanguage: snapshot.preferredLanguage,
  firstNames: snapshot.firstNames,
  lastNames: snapshot.lastNames,
  status: snapshot.status,
  roles: [...snapshot.roles],
  avatarUrl: snapshot.avatarStorageKey.trim().length > 0 ? buildAvatarUrl(snapshot.id) : null,
})
