import { readFile } from 'node:fs/promises'
import type * as FileSystem from 'node:fs/promises'
import { LocalAvatarStorage } from '../../src/adapters/outbound/storage/LocalAvatarStorage'

jest.mock('node:fs/promises', () => ({
  ...jest.requireActual<typeof FileSystem>('node:fs/promises'),
  readFile: jest.fn(),
}))

describe('LocalAvatarStorage distingue ausencia e indisponibilidad', () => {
  const read = jest.mocked(readFile)
  const storage = new LocalAvatarStorage('./data/avatars')
  afterEach(() => jest.resetAllMocks())
  it('solo ENOENT representa un avatar ausente', async () => {
    read.mockRejectedValueOnce(Object.assign(new Error('no existe'), { code: 'ENOENT' }))
    expect(await storage.read('cuenta/avatar.png')).toBeNull()
  })
  it.each(['EACCES', 'EIO', 'ENOTDIR'])(
    'propaga %s sin convertirlo en avatar invalido',
    async (code) => {
      const error = Object.assign(new Error('almacenamiento no disponible'), { code })
      read.mockRejectedValueOnce(error)
      await expect(storage.read('cuenta/avatar.png', { failOnUnavailable: true })).rejects.toBe(
        error,
      )
    },
  )
  it('conserva el comportamiento publicado cuando no se solicita disponibilidad estricta', async () => {
    read.mockRejectedValueOnce(Object.assign(new Error('permiso denegado'), { code: 'EACCES' }))
    expect(await storage.read('cuenta/avatar.png')).toBeNull()
  })
  it('no lee claves que salen del area configurada', async () => {
    expect(await storage.read('../archivo-externo')).toBeNull()
    expect(read).not.toHaveBeenCalled()
  })
})
