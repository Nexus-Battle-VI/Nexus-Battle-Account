import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type {
  AvatarStoragePort,
  AvatarStoreInput,
  StoredAvatar,
} from '../../../application/ports/AvatarStoragePort'

/**
 * Almacenamiento local de avatares. La ruta base es configurable
 * (`AVATAR_STORAGE_PATH`) para poder sustituirlo por un adaptador AWS.
 */
export class LocalAvatarStorage implements AvatarStoragePort {
  private readonly basePath: string

  constructor(basePath: string) {
    this.basePath = basePath
  }

  async store(input: AvatarStoreInput): Promise<StoredAvatar> {
    const safeName = input.originalName.replace(/[^a-zA-Z0-9._-]/gu, '_')
    const storageKey = `${input.accountId}/${safeName}`
    const fullPath = path.join(this.basePath, storageKey)

    await mkdir(path.dirname(fullPath), { recursive: true })
    await writeFile(fullPath, input.bytes)

    return { storageKey, sizeBytes: input.bytes.length }
  }

  async remove(storageKey: string): Promise<void> {
    await rm(path.join(this.basePath, storageKey), { force: true })
  }
}
