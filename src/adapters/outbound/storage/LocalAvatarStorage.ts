import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
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
  private readonly resolvedBasePath: string

  constructor(basePath: string) {
    this.basePath = basePath
    this.resolvedBasePath = path.resolve(basePath)
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

  /**
   * NO SE FIA DE LA CLAVE. `storageKey` viaja desde la cuenta persistida hasta
   * aqui sin pasar por ninguna validacion de dominio -es una cadena libre-, asi
   * que este metodo resuelve la ruta y comprueba que siga dentro de
   * `basePath` ANTES de leer. Sin esa comprobacion, una clave como
   * `../../../etc/passwd` (llegada por un error de datos, no necesariamente
   * por un ataque) leeria fuera del area de avatares y lo devolveria como si
   * fuera una imagen de cuenta.
   */
  async read(storageKey: string): Promise<Buffer | null> {
    const fullPath = path.resolve(this.basePath, storageKey)

    if (
      fullPath !== this.resolvedBasePath &&
      !fullPath.startsWith(this.resolvedBasePath + path.sep)
    ) {
      return null
    }

    try {
      return await readFile(fullPath)
    } catch {
      return null
    }
  }
}
