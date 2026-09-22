export interface AvatarStoreInput {
  readonly accountId: string
  readonly mimeType: string
  readonly originalName: string
  readonly bytes: Buffer
}

export interface StoredAvatar {
  readonly storageKey: string
  readonly sizeBytes: number
}

/**
 * Puerto de almacenamiento de avatares.
 *
 * El dominio solo conoce metadatos. LocalAvatarStorage escribe en disco;
 * un adaptador AWS sustituye esta implementacion sin tocar RegisterAccount.
 */
export interface AvatarStoragePort {
  store(input: AvatarStoreInput): Promise<StoredAvatar>
  remove(storageKey: string): Promise<void>

  /**
   * Lee los bytes de un avatar ya almacenado.
   *
   * Devuelve `null` cuando la clave no resuelve a ningun archivo -avatar
   * eliminado, clave invalida o cuenta sin avatar recuperable-, nunca lanza
   * por ausencia: quien la invoca (`GetAccountAvatar`) decide si eso es un 404
   * o una cuenta historica sin avatar, no el adaptador.
   *
   * El propio adaptador es responsable de impedir que `storageKey` escape del
   * area de almacenamiento (recorrido de rutas via `../`): el valor persistido
   * en la cuenta deberia ser siempre seguro, pero el metodo no confia en eso.
   */
  read(storageKey: string): Promise<Buffer | null>
}

export const AVATAR_STORAGE = Symbol('AvatarStoragePort')
