import { UpdateOwnAccount } from '../../src/application/use-cases/UpdateOwnAccount'
import { InMemoryAccountRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountRepository'
import { InMemoryNicknameBlacklist } from '../../src/adapters/outbound/persistence/InMemoryNicknameBlacklist'
import {
  AccountNotFoundError,
  DisplayNameAlreadyTakenError,
  NicknameBlacklistedError,
} from '../../src/application/errors/ApplicationError'
import { DomainError } from '../../src/domain/errors/DomainError'
import { AccountStatus } from '../../src/domain/entities/AccountStatus'
import { Role } from '../../src/domain/entities/Role'
import { buildActiveAccount } from '../support/account-factory'

const setup = async (): Promise<{
  caso: UpdateOwnAccount
  accounts: InMemoryAccountRepository
}> => {
  const accounts = new InMemoryAccountRepository()
  await accounts.save(
    buildActiveAccount({
      id: 'acc-propia',
      subject: 'sub-propia',
      email: 'ana@nexus.test',
      displayName: 'Ana Ramirez',
      roles: [Role.Player, Role.Moderator],
    }),
  )

  return { caso: new UpdateOwnAccount(accounts, new InMemoryNicknameBlacklist()), accounts }
}

describe('UpdateOwnAccount', () => {
  it('cambia el apodo, persiste y devuelve el estado actualizado', async () => {
    const { caso, accounts } = await setup()

    const dto = await caso.execute({ subject: 'sub-propia', displayName: 'Ana Editada' })

    expect(dto.displayName).toBe('Ana Editada')

    const releida = await accounts.findBySubject('sub-propia')
    expect(releida?.currentDisplayName.value).toBe('Ana Editada')
  })

  it('conserva roles, estado, correo y sujeto al cambiar el apodo', async () => {
    const { caso, accounts } = await setup()

    await caso.execute({ subject: 'sub-propia', displayName: 'Ana Editada' })

    const releida = await accounts.findBySubject('sub-propia')
    expect(releida?.currentRoles).toEqual([Role.Player, Role.Moderator])
    expect(releida?.currentStatus).toBe(AccountStatus.Active)
    expect(releida?.currentEmail.value).toBe('ana@nexus.test')
    expect(releida?.subject).toBe('sub-propia')
  })

  it('rechaza un apodo con formato invalido sin tocar la cuenta', async () => {
    const { caso, accounts } = await setup()

    await expect(caso.execute({ subject: 'sub-propia', displayName: 'ab' })).rejects.toBeInstanceOf(
      DomainError,
    )

    const releida = await accounts.findBySubject('sub-propia')
    expect(releida?.currentDisplayName.value).toBe('Ana Ramirez')
  })

  it('rechaza un apodo bloqueado por la lista negra vigente', async () => {
    const { caso } = await setup()

    await expect(
      caso.execute({ subject: 'sub-propia', displayName: 'admin' }),
    ).rejects.toBeInstanceOf(NicknameBlacklistedError)
  })

  it('rechaza un apodo que ya usa OTRA cuenta', async () => {
    const { caso, accounts } = await setup()
    await accounts.save(
      buildActiveAccount({
        id: 'acc-ajena',
        subject: 'sub-ajena',
        email: 'otra@nexus.test',
        displayName: 'Nombre Ocupado',
      }),
    )

    await expect(
      caso.execute({ subject: 'sub-propia', displayName: 'Nombre Ocupado' }),
    ).rejects.toBeInstanceOf(DisplayNameAlreadyTakenError)
  })

  it('acepta la edicion idempotente del MISMO apodo sin choque consigo misma', async () => {
    const { caso } = await setup()

    const dto = await caso.execute({ subject: 'sub-propia', displayName: 'Ana Ramirez' })

    expect(dto.displayName).toBe('Ana Ramirez')
  })

  it('acepta cambiar solo las mayusculas del propio apodo (no es otro propietario)', async () => {
    const { caso, accounts } = await setup()

    const dto = await caso.execute({ subject: 'sub-propia', displayName: 'ANA RAMIREZ' })

    expect(dto.displayName).toBe('ANA RAMIREZ')
    const releida = await accounts.findBySubject('sub-propia')
    expect(releida?.currentDisplayName.value).toBe('ANA RAMIREZ')
  })

  it('falla cuando el sujeto no tiene cuenta en este servicio', async () => {
    const { caso } = await setup()

    await expect(
      caso.execute({ subject: 'sub-desconocido', displayName: 'Cualquiera' }),
    ).rejects.toBeInstanceOf(AccountNotFoundError)
  })

  it('propaga un fallo de persistencia en lugar de reportar exito', async () => {
    const accounts = new InMemoryAccountRepository()
    await accounts.save(
      buildActiveAccount({ id: 'acc-1', subject: 'sub-1', displayName: 'Ana Ramirez' }),
    )
    jest.spyOn(accounts, 'save').mockRejectedValueOnce(new Error('almacen no disponible'))

    const caso = new UpdateOwnAccount(accounts, new InMemoryNicknameBlacklist())

    await expect(caso.execute({ subject: 'sub-1', displayName: 'Ana Nueva' })).rejects.toThrow(
      'almacen no disponible',
    )
  })
})
