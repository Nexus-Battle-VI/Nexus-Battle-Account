import { Account } from '../../src/domain/entities/Account'
import { AccountStatus } from '../../src/domain/entities/AccountStatus'
import { ALL_ROLES, Role, isRole } from '../../src/domain/entities/Role'
import { RolePolicy } from '../../src/domain/policies/RolePolicy'
import { AccountId } from '../../src/domain/value-objects/AccountId'
import { DisplayName } from '../../src/domain/value-objects/DisplayName'
import { EmailAddress } from '../../src/domain/value-objects/EmailAddress'
import { DomainError } from '../../src/domain/errors/DomainError'

const AT = new Date('2026-08-21T10:00:00.000Z')

const buildAccount = (): Account =>
  Account.register({
    id: AccountId.create('acc-1'),
    subject: 'sujeto-1',
    email: EmailAddress.create('jugador@nexus.test'),
    displayName: DisplayName.create('Ana Ramirez'),
    occurredAt: AT,
  })

const adminRoles = new Set<Role>([Role.Administrator])
const playerRoles = new Set<Role>([Role.Player])

describe('EmailAddress', () => {
  it('normaliza espacios y mayusculas', () => {
    expect(EmailAddress.create('  Jugador@Nexus.Test ').value).toBe('jugador@nexus.test')
  })

  it('compara por valor y se representa como texto', () => {
    const email = EmailAddress.create('a@nexus.test')
    expect(email.equals(EmailAddress.create('A@NEXUS.TEST'))).toBe(true)
    expect(email.equals(EmailAddress.create('b@nexus.test'))).toBe(false)
    expect(String(email)).toBe('a@nexus.test')
  })

  it.each([
    ['vacia', '   '],
    ['sin arroba', 'jugador.nexus.test'],
    ['sin dominio', 'jugador@'],
    ['sin punto en el dominio', 'jugador@localhost'],
    ['con espacio interno', 'jug ador@nexus.test'],
  ])('rechaza una direccion %s', (_caso, raw) => {
    expect(() => EmailAddress.create(raw)).toThrow(DomainError)
  })

  it('rechaza una direccion mas larga que el limite', () => {
    expect(() => EmailAddress.create(`${'a'.repeat(250)}@nexus.test`)).toThrow(/supera 254/)
  })
})

describe('DisplayName', () => {
  it('colapsa espacios internos', () => {
    expect(DisplayName.create('  Ana    Ramirez  ').value).toBe('Ana Ramirez')
  })

  it('admite letras acentuadas y digitos', () => {
    expect(DisplayName.create('Jose Nunez 99').value).toBe('Jose Nunez 99')
  })

  it('compara por valor y se representa como texto', () => {
    const name = DisplayName.create('Ana Ramirez')
    expect(name.equals(DisplayName.create('Ana Ramirez'))).toBe(true)
    expect(name.equals(DisplayName.create('Otro Nombre'))).toBe(false)
    expect(String(name)).toBe('Ana Ramirez')
  })

  it.each([
    ['demasiado corto', 'Ab'],
    ['demasiado largo', 'x'.repeat(33)],
    ['empieza con delimitador', '_Ana'],
    ['termina con delimitador', 'Ana.'],
    ['con caracteres no permitidos', 'Ana<script>'],
  ])('rechaza un nombre %s', (_caso, raw) => {
    expect(() => DisplayName.create(raw)).toThrow(DomainError)
  })
})

describe('AccountId', () => {
  it('normaliza espacios', () => {
    expect(AccountId.create('  acc-1 ').value).toBe('acc-1')
  })

  it('compara por valor y se representa como texto', () => {
    expect(AccountId.create('acc-1').equals(AccountId.create('acc-1'))).toBe(true)
    expect(AccountId.create('acc-1').equals(AccountId.create('acc-2'))).toBe(false)
    expect(String(AccountId.create('acc-1'))).toBe('acc-1')
  })

  it('rechaza un identificador vacio', () => {
    expect(() => AccountId.create('  ')).toThrow(DomainError)
  })
})

describe('Role', () => {
  it('reconoce los roles validos', () => {
    expect(ALL_ROLES).toHaveLength(3)
    expect(isRole('ADMINISTRATOR')).toBe(true)
    expect(isRole('SUPERUSER')).toBe(false)
  })
})

describe('RolePolicy', () => {
  it('define jugador como rol base no retirable', () => {
    expect(RolePolicy.baseRole).toBe(Role.Player)
    expect(RolePolicy.isRemovable(Role.Player)).toBe(false)
    expect(RolePolicy.isRemovable(Role.Moderator)).toBe(true)
  })

  it('solo el administrador gestiona roles', () => {
    expect(RolePolicy.canManageRoles(adminRoles)).toBe(true)
    expect(RolePolicy.canManageRoles(playerRoles)).toBe(false)
  })
})

describe('Account', () => {
  it('nace pendiente de verificacion con el rol base y emite el evento', () => {
    const account = buildAccount()

    expect(account.currentStatus).toBe(AccountStatus.PendingVerification)
    expect(account.currentRoles).toEqual([Role.Player])
    expect(account.canAuthenticate).toBe(false)
    expect(account.hasRole(Role.Player)).toBe(true)
    expect(account.hasRole(Role.Administrator)).toBe(false)

    const events = account.pullEvents()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      name: 'account.registered',
      aggregateId: 'acc-1',
      email: 'jugador@nexus.test',
    })
    expect(account.pullEvents()).toHaveLength(0)
  })

  it('expone correo y nombre actuales', () => {
    const account = buildAccount()

    expect(account.currentEmail.value).toBe('jugador@nexus.test')
    expect(account.currentDisplayName.value).toBe('Ana Ramirez')
  })

  it('habilita la autenticacion al verificarse', () => {
    const account = buildAccount()
    account.pullEvents()

    account.verify(AT)

    expect(account.currentStatus).toBe(AccountStatus.Active)
    expect(account.canAuthenticate).toBe(true)
    expect(account.pullEvents()[0]).toMatchObject({ name: 'account.verified' })
  })

  it('rechaza verificar dos veces', () => {
    const account = buildAccount()
    account.verify(AT)

    expect(() => {
      account.verify(AT)
    }).toThrow(/ya fue verificada/)
  })

  it('rechaza verificar una cuenta suspendida', () => {
    const account = buildAccount()
    account.suspend()

    expect(() => {
      account.verify(AT)
    }).toThrow(/suspendida/)
  })

  it('suspende y reincorpora una cuenta', () => {
    const account = buildAccount()
    account.verify(AT)

    account.suspend()
    expect(account.currentStatus).toBe(AccountStatus.Suspended)
    expect(account.canAuthenticate).toBe(false)

    account.reinstate()
    expect(account.currentStatus).toBe(AccountStatus.Active)
  })

  it('rechaza suspender dos veces y reincorporar lo no suspendido', () => {
    const account = buildAccount()
    account.suspend()

    expect(() => {
      account.suspend()
    }).toThrow(/ya esta suspendida/)

    account.reinstate()
    expect(() => {
      account.reinstate()
    }).toThrow(/no esta suspendida/)
  })

  it('permite renombrar sin alterar el estado', () => {
    const account = buildAccount()
    account.verify(AT)

    account.rename(DisplayName.create('Ana R'))

    expect(account.currentDisplayName.value).toBe('Ana R')
    expect(account.currentStatus).toBe(AccountStatus.Active)
  })

  it('invalida la verificacion al cambiar el correo', () => {
    const account = buildAccount()
    account.verify(AT)
    account.pullEvents()

    expect(account.changeEmail(EmailAddress.create('nuevo@nexus.test'), AT)).toBe(true)
    expect(account.currentStatus).toBe(AccountStatus.PendingVerification)
    expect(account.currentEmail.value).toBe('nuevo@nexus.test')
    expect(account.pullEvents()[0]).toMatchObject({
      name: 'account.email-changed',
      previousEmail: 'jugador@nexus.test',
      newEmail: 'nuevo@nexus.test',
    })
  })

  it('ignora un cambio de correo al mismo valor', () => {
    const account = buildAccount()
    account.verify(AT)
    account.pullEvents()

    expect(account.changeEmail(EmailAddress.create('JUGADOR@NEXUS.TEST'), AT)).toBe(false)
    expect(account.currentStatus).toBe(AccountStatus.Active)
    expect(account.pullEvents()).toHaveLength(0)
  })

  it('permite a un administrador conceder y retirar roles', () => {
    const account = buildAccount()

    account.grantRole(Role.Moderator, adminRoles)
    expect(account.hasRole(Role.Moderator)).toBe(true)

    account.revokeRole(Role.Moderator, adminRoles)
    expect(account.hasRole(Role.Moderator)).toBe(false)
  })

  it('impide gestionar roles sin permiso de administrador', () => {
    const account = buildAccount()

    expect(() => {
      account.grantRole(Role.Moderator, playerRoles)
    }).toThrow(/Solo un administrador/)
    expect(() => {
      account.revokeRole(Role.Player, playerRoles)
    }).toThrow(/Solo un administrador/)
  })

  it('impide retirar el rol base', () => {
    const account = buildAccount()

    expect(() => {
      account.revokeRole(Role.Player, adminRoles)
    }).toThrow(/minimo de toda cuenta/)
  })

  it('reconstituye una cuenta persistida sin emitir eventos', () => {
    const account = Account.restore({
      id: AccountId.create('acc-9'),
      subject: 'sujeto-9',
      email: EmailAddress.create('otro@nexus.test'),
      displayName: DisplayName.create('Otro Jugador'),
      status: AccountStatus.Active,
      roles: [Role.Player, Role.Moderator],
    })

    expect(account.pullEvents()).toHaveLength(0)
    expect(account.canAuthenticate).toBe(true)
    expect(account.currentRoles).toEqual([Role.Player, Role.Moderator])
  })

  it('rechaza reconstituir una cuenta sin roles', () => {
    expect(() =>
      Account.restore({
        id: AccountId.create('acc-9'),
        subject: 'sujeto-9',
        email: EmailAddress.create('otro@nexus.test'),
        displayName: DisplayName.create('Otro Jugador'),
        status: AccountStatus.Active,
        roles: [],
      }),
    ).toThrow(DomainError)
  })

  it('produce una instantanea consistente', () => {
    const account = buildAccount()

    expect(account.toSnapshot()).toEqual({
      id: 'acc-1',
      subject: 'sujeto-1',
      email: 'jugador@nexus.test',
      displayName: 'Ana Ramirez',
      status: AccountStatus.PendingVerification,
      roles: [Role.Player],
    })
  })
})

describe('Vinculo con el sujeto de identidad', () => {
  it('conserva el sujeto en la instantanea', () => {
    expect(buildAccount().toSnapshot().subject).toBe('sujeto-1')
  })

  /**
   * Sin sujeto no hay forma de saber de quien es la cuenta, y una cuenta que no
   * se puede atribuir a nadie no deberia poder existir. Fallar al crearla es
   * preferible a crearla y descubrirlo al intentar autorizar.
   */
  it('rechaza registrar una cuenta sin sujeto', () => {
    expect(() =>
      Account.register({
        id: AccountId.create('acc-2'),
        subject: '   ',
        email: EmailAddress.create('otro@nexus.test'),
        displayName: DisplayName.create('Otro Jugador'),
        occurredAt: AT,
      }),
    ).toThrow(/sujeto de identidad/)
  })

  it('rechaza reconstituir una cuenta sin sujeto', () => {
    expect(() =>
      Account.restore({
        id: AccountId.create('acc-2'),
        subject: '',
        email: EmailAddress.create('otro@nexus.test'),
        displayName: DisplayName.create('Otro Jugador'),
        status: AccountStatus.Active,
        roles: [Role.Player],
      }),
    ).toThrow(/sujeto de identidad/)
  })

  /**
   * El correo cambia y devuelve la cuenta a pendiente de verificacion. El
   * sujeto NO cambia: es lo unico estable, y por eso el vinculo se hace contra
   * el y no contra el correo.
   */
  it('mantiene el sujeto cuando cambia el correo', () => {
    const account = buildAccount()
    account.changeEmail(EmailAddress.create('nuevo@nexus.test'), AT)

    expect(account.subject).toBe('sujeto-1')
    expect(account.currentEmail.value).toBe('nuevo@nexus.test')
  })
})
