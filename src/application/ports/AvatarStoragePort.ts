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
}

export const AVATAR_STORAGE = Symbol('AvatarStoragePort')
