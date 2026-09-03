import { Account } from '../../src/domain/entities/Account'
import { AccountStatus } from '../../src/domain/entities/AccountStatus'
import { ALL_ROLES, Role, isAdministrativeRole, isRole } from '../../src/domain/entities/Role'
import { RolePolicy } from '../../src/domain/policies/RolePolicy'
import { AccountId } from '../../src/domain/value-objects/AccountId'
import { DisplayName } from '../../src/domain/value-objects/DisplayName'
import { EmailAddress } from '../../src/domain/value-objects/EmailAddress'
import { PersonName } from '../../src/domain/value-objects/PersonName'
import { DomainError } from '../../src/domain/errors/DomainError'
import { PasswordPolicy } from '../../src/domain/policies/PasswordPolicy'
import { AT, buildAccount, defaultAvatarMetadata } from '../support/account-factory'

const adminRoles = new Set<Role>([Role.Administrator])
const superAdministratorRoles = new Set<Role>([Role.SuperAdministrator])
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
  it('reconoce los roles validos, incluido SUPER_ADMINISTRATOR (HU-02)', () => {
    expect(ALL_ROLES).toHaveLength(4)
    expect(isRole('ADMINISTRATOR')).toBe(true)
    expect(isRole('SUPER_ADMINISTRATOR')).toBe(true)
    expect(isRole('SUPERUSER')).toBe(false)
  })

  it('identifica los roles que exigen segundo factor (HU-02, CA-06)', () => {
    expect(isAdministrativeRole([Role.Administrator])).toBe(true)
    expect(isAdministrativeRole([Role.SuperAdministrator])).toBe(true)
    expect(isAdministrativeRole([Role.Player, Role.Moderator])).toBe(false)
    expect(isAdministrativeRole([])).toBe(false)
  })
})

describe('RolePolicy', () => {
  it('define jugador como rol base no retirable', () => {
    expect(RolePolicy.baseRole).toBe(Role.Player)
    expect(RolePolicy.isRemovable(Role.Player)).toBe(false)
    expect(RolePolicy.isRemovable(Role.Moderator)).toBe(true)
  })

  it('solo el Super Administrador gestiona roles', () => {
    expect(RolePolicy.canManageRoles(superAdministratorRoles)).toBe(true)
    expect(RolePolicy.canManageRoles(adminRoles)).toBe(false)
    expect(RolePolicy.canManageRoles(playerRoles)).toBe(false)
  })
})

describe('Account', () => {
  /**
   * `PENDING_VERIFICATION` espera la prueba de que alguien controla el buzon, y
   * el proveedor de identidad ya la entrega en el testimonio. Pedirla otra vez
   * dejaba la cuenta esperando algo que NADIE resolvia: `VerifyAccount` solo lo
   * invoca un endpoint que exige rol ADMINISTRATOR, asi que toda cuenta nacida
   * del flujo real se quedaba pendiente para siempre y no podia usar el inicio
   * de sesion por credenciales, que exige `canAuthenticate`.
   */
  it('nace ACTIVA cuando el proveedor ya declaro verificado ese correo', () => {
    const account = buildAccount({ emailAlreadyVerified: true })

    expect(account.currentStatus).toBe(AccountStatus.Active)
    expect(account.canAuthenticate).toBe(true)
  })

  /**
   * El control del caso anterior, y la razon de que el dato venga del
   * TESTIMONIO y no del formulario. Sin esta prueba, bastaria con que alguien
   * escribiera un correo cualquiera para nacer activo.
   */
  it('sigue pendiente si no consta esa verificacion', () => {
    const account = buildAccount({ emailAlreadyVerified: false })

    expect(account.currentStatus).toBe(AccountStatus.PendingVerification)
    expect(account.canAuthenticate).toBe(false)
  })

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

  it('permite al Super Administrador conceder y retirar roles', () => {
    const account = buildAccount()

    account.grantRole(Role.Moderator, superAdministratorRoles)
    expect(account.hasRole(Role.Moderator)).toBe(true)

    account.revokeRole(Role.Moderator, superAdministratorRoles)
    expect(account.hasRole(Role.Moderator)).toBe(false)
  })

  it('impide gestionar roles sin permiso de Super Administrador', () => {
    const account = buildAccount()

    expect(() => {
      account.grantRole(Role.Moderator, playerRoles)
    }).toThrow(/Solo un Super Administrador/)
    expect(() => {
      account.revokeRole(Role.Player, playerRoles)
    }).toThrow(/Solo un Super Administrador/)
  })

  it('impide retirar el rol base', () => {
    const account = buildAccount()

    expect(() => {
      account.revokeRole(Role.Player, superAdministratorRoles)
    }).toThrow(/minimo de toda cuenta/)
  })

  it('reconstituye una cuenta persistida sin emitir eventos', () => {
    const account = Account.restore({
      id: AccountId.create('acc-9'),
      subject: 'sujeto-9',
      email: EmailAddress.create('otro@nexus.test'),
      displayName: DisplayName.create('Otro Jugador'),
      firstNames: PersonName.create('Otro', 'Los nombres'),
      lastNames: PersonName.create('Jugador', 'Los apellidos'),
      termsAccepted: true,
      avatar: defaultAvatarMetadata('acc-9'),
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
        firstNames: PersonName.create('Otro', 'Los nombres'),
        lastNames: PersonName.create('Jugador', 'Los apellidos'),
        termsAccepted: true,
        avatar: defaultAvatarMetadata('acc-9'),
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
      countryCode: null,
      firstNames: 'Ana',
      lastNames: 'Ramirez',
      termsAccepted: true,
      avatarStorageKey: 'acc-1/a.png',
      avatarMimeType: 'image/png',
      avatarSizeBytes: 12,
      avatarOriginalName: 'a.png',
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
        firstNames: PersonName.create('Otro', 'Los nombres'),
        lastNames: PersonName.create('Jugador', 'Los apellidos'),
        termsAccepted: true,
        avatar: defaultAvatarMetadata('acc-2'),
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
        firstNames: PersonName.create('Otro', 'Los nombres'),
        lastNames: PersonName.create('Jugador', 'Los apellidos'),
        termsAccepted: true,
        avatar: defaultAvatarMetadata('acc-2'),
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

describe('PersonName', () => {
  it('rechaza nombres vacios', () => {
    expect(() => PersonName.create('   ', 'Los nombres')).toThrow(/nombres no puede estar vacio/)
    expect(() => PersonName.create('', 'Los apellidos')).toThrow(/apellidos no puede estar vacio/)
  })

  it('normaliza espacios', () => {
    expect(PersonName.create('  Ana   Maria ', 'Los nombres').value).toBe('Ana Maria')
  })
})

describe('PasswordPolicy', () => {
  it('acepta una contrasena valida', () => {
    expect(() => {
      PasswordPolicy.assertValid('Abcdefg1!')
    }).not.toThrow()
  })

  it('rechaza 8 caracteres o menos', () => {
    expect(() => {
      PasswordPolicy.assertValid('Abcde1!x')
    }).toThrow(/mas de 8/)
  })

  it('rechaza la ausencia de mayuscula, minuscula, numero o simbolo', () => {
    expect(() => {
      PasswordPolicy.assertValid('abcdefg1!')
    }).toThrow(/mayuscula/)
    expect(() => {
      PasswordPolicy.assertValid('ABCDEFG1!')
    }).toThrow(/minuscula/)
    expect(() => {
      PasswordPolicy.assertValid('Abcdefgh!')
    }).toThrow(/numero/)
    expect(() => {
      PasswordPolicy.assertValid('Abcdefg12')
    }).toThrow(/simbolo/)
  })
})
