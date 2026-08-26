import { DomainError } from '../errors/DomainError'

/** 500 MiB. El limite vive en dominio para que no dependa del adaptador HTTP. */
export const AVATAR_MAX_BYTES = 500 * 1024 * 1024

export interface AvatarMetadataParams {
  readonly storageKey: string
  readonly mimeType: string
  readonly sizeBytes: number
  readonly originalName: string
}

/**
 * Metadatos del avatar persistidos en la cuenta.
 *
 * Los bytes no forman parte del agregado: viven detras de AvatarStoragePort.
 */
export class AvatarMetadata {
  readonly storageKey: string
  readonly mimeType: string
  readonly sizeBytes: number
  readonly originalName: string

  private constructor(params: AvatarMetadataParams) {
    this.storageKey = params.storageKey
    this.mimeType = params.mimeType
    this.sizeBytes = params.sizeBytes
    this.originalName = params.originalName
  }

  static create(params: AvatarMetadataParams): AvatarMetadata {
    if (params.storageKey.trim().length === 0) {
      throw new DomainError('El avatar debe tener una clave de almacenamiento.')
    }

    if (!params.mimeType.startsWith('image/')) {
      throw new DomainError('El avatar debe ser una imagen (image/*).')
    }

    if (!Number.isInteger(params.sizeBytes) || params.sizeBytes <= 0) {
      throw new DomainError('El avatar debe tener un tamano valido.')
    }

    if (params.sizeBytes > AVATAR_MAX_BYTES) {
      throw new DomainError(`El avatar no puede superar ${String(AVATAR_MAX_BYTES)} bytes.`)
    }

    if (params.originalName.trim().length === 0) {
      throw new DomainError('El avatar debe conservar su nombre original.')
    }

    return new AvatarMetadata({
      storageKey: params.storageKey.trim(),
      mimeType: params.mimeType,
      sizeBytes: params.sizeBytes,
      originalName: params.originalName.trim(),
    })
  }
}

export const assertAvatarUpload = (params: {
  readonly mimeType: string
  readonly sizeBytes: number
  readonly originalName: string
}): void => {
  AvatarMetadata.create({
    storageKey: 'pending',
    mimeType: params.mimeType,
    sizeBytes: params.sizeBytes,
    originalName: params.originalName,
  })
}
