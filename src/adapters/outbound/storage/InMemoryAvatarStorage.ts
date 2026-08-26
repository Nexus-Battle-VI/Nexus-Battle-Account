import type {
  AvatarStoragePort,
  AvatarStoreInput,
  StoredAvatar,
} from '../../../application/ports/AvatarStoragePort'

export class InMemoryAvatarStorage implements AvatarStoragePort {
  private readonly stored = new Map<string, Buffer>()

  store(input: AvatarStoreInput): Promise<StoredAvatar> {
    const storageKey = `${input.accountId}/${input.originalName}`
    this.stored.set(storageKey, input.bytes)

    return Promise.resolve({ storageKey, sizeBytes: input.bytes.length })
  }

  remove(storageKey: string): Promise<void> {
    this.stored.delete(storageKey)

    return Promise.resolve()
  }

  get size(): number {
    return this.stored.size
  }

  has(storageKey: string): boolean {
    return this.stored.has(storageKey)
  }
}
