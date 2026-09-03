import 'reflect-metadata'

import {
  PersistenceMappingError,
  toRow,
  toSnapshot,
  type AccountRow,
} from '../../src/adapters/outbound/persistence/mapping'
import { AccountStatus } from '../../src/domain/entities/AccountStatus'
import { ALL_ROLES, Role } from '../../src/domain/entities/Role'
import { up } from '../../src/adapters/outbound/persistence/migrations/001-accounts'
import { up as upSuperAdministratorRole } from '../../src/adapters/outbound/persistence/migrations/hu03-super-administrator-role'
import { describeError } from '../../src/infrastructure/observability/describe-error'

const ROW: AccountRow = {
  id: 'acc-1',
  subject: 'sujeto-1',
  email: 'ana@nexus.test',
  display_name: 'Ana Ramirez',
  country_code: null,
  first_names: 'Ana',
  last_names: 'Ramirez',
  terms_accepted: true,
  avatar_storage_key: 'acc-1/a.png',
  avatar_mime_type: 'image/png',
  avatar_size_bytes: 12,
  avatar_original_name: 'a.png',
  status: AccountStatus.Active,
}

describe('Traduccion entre fila e instantanea', () => {
  it('reconstruye la instantanea completa', () => {
    expect(toSnapshot(ROW, [Role.Player, Role.Moderator])).toEqual({
      id: 'acc-1',
      subject: 'sujeto-1',
      email: 'ana@nexus.test',
      displayName: 'Ana Ramirez',
      countryCode: null,
      firstNames: 'Ana',
      lastNames: 'Ramirez',
      termsAccepted: true,
      avatarStorageKey: 'acc-1/a.png',
      avatarMimeType: 'image/png',
      avatarSizeBytes: 12,
      avatarOriginalName: 'a.png',
      status: AccountStatus.Active,
      roles: [Role.Player, Role.Moderator],
    })
  })

  it('descompone la instantanea en columnas', () => {
    const snapshot = toSnapshot(ROW, [Role.Player])

    expect(toRow(snapshot)).toEqual(ROW)
  })

  it('la traduccion es reversible', () => {
    expect(toRow(toSnapshot(ROW, [Role.Player]))).toEqual(ROW)
  })

  /**
   * Puede parecer excesivo validar lo que viene de la propia base de datos, que
   * ya tiene sus restricciones. Pero una fila escrita por una version anterior
   * del esquema, o por una migracion a medias, llegaria aqui sin que nada la
   * detuviera. Construir un agregado con un estado que el dominio no reconoce es
   * peor que fallar al leerlo.
   */
  it('rechaza un estado que el dominio no reconoce', () => {
    expect(() => toSnapshot({ ...ROW, status: 'BORRADO' }, [Role.Player])).toThrow(
      PersistenceMappingError,
    )
  })

  it('rechaza un rol que el dominio no reconoce', () => {
    expect(() => toSnapshot(ROW, [Role.Player, 'SUPERUSUARIO'])).toThrow(PersistenceMappingError)
  })

  /**
   * El agregado exige al menos un rol. Fallar aqui senala el problema real —una
   * fila sin roles— en lugar de un error del dominio sobre datos que el dominio
   * no escribio.
   */
  it('rechaza una cuenta sin ningun rol almacenado', () => {
    expect(() => toSnapshot(ROW, [])).toThrow(/no tiene ningun rol/)
  })
})

/**
 * Una migracion NO puede importar el dominio: queda congelada en el tiempo y
 * tiene que seguir siendo ejecutable tal y como se escribio, aunque el dominio
 * cambie despues. Eso obliga a repetir el vocabulario en la restriccion SQL.
 *
 * Esta prueba es lo que evita que esa duplicacion se convierta en divergencia:
 * si alguien anade un estado o un rol al dominio sin escribir la migracion
 * correspondiente, falla aqui y no en produccion al intentar guardar.
 *
 * El vocabulario de roles ya no vive en un unico archivo: `001-accounts`
 * declaro la restriccion original (PLAYER/MODERATOR/ADMINISTRATOR) y
 * `hu03-super-administrator-role` la ALTERA para anadir SUPER_ADMINISTRATOR
 * (HU-02). Una migracion aplicada no se edita, asi que el vocabulario EFECTIVO
 * de hoy es la union de ambos textos, no solo el de `001-accounts`.
 */
describe('El vocabulario del dominio y el de la migracion no divergen', () => {
  const sqlDeLaMigracion = up.toString()
  const sqlDelVocabularioDeRoles = up.toString() + upSuperAdministratorRole.toString()

  it.each(Object.values(AccountStatus))('la migracion admite el estado %s', (status) => {
    expect(sqlDeLaMigracion).toContain(`'${status}'`)
  })

  it.each(ALL_ROLES)('la union de migraciones admite el rol %s', (role) => {
    expect(sqlDelVocabularioDeRoles).toContain(`'${role}'`)
  })

  it('la migracion inicial no admite valores que el dominio desconoce', () => {
    const enLaRestriccion = [...sqlDeLaMigracion.matchAll(/'([A-Z_]{3,})'/g)].map(
      (match) => match[1]!,
    )
    const conocidos: readonly string[] = [...Object.values(AccountStatus), ...ALL_ROLES]

    expect(enLaRestriccion.filter((value) => !conocidos.includes(value))).toEqual([])
  })

  it('la migracion de SUPER_ADMINISTRATOR no admite valores que el dominio desconoce', () => {
    const enLaRestriccion = [
      ...upSuperAdministratorRole.toString().matchAll(/'([A-Z_]{3,})'/g),
    ].map((match) => match[1]!)

    expect(
      enLaRestriccion.filter((value) => !(ALL_ROLES as readonly string[]).includes(value)),
    ).toEqual([])
  })
})

/**
 * Muchas bibliotecas rechazan con `unknown`. Pasar eso por `String()` a secas
 * convierte cualquier objeto en `[object Object]` justo cuando mas falta hace
 * saber que ocurrio.
 */
describe('describeError', () => {
  it('usa el mensaje cuando es un Error', () => {
    expect(describeError(new Error('algo fallo'))).toBe('algo fallo')
  })

  it('serializa un objeto en lugar de producir [object Object]', () => {
    expect(describeError({ code: '23505', detail: 'duplicado' })).toBe(
      '{"code":"23505","detail":"duplicado"}',
    )
  })

  it.each([
    [undefined, 'undefined'],
    [null, 'null'],
  ])('describe %s sin romperse', (valor, esperado) => {
    expect(describeError(valor)).toBe(esperado)
  })

  it('no se rompe con una estructura circular', () => {
    const circular: Record<string, unknown> = {}
    circular.yo = circular

    expect(describeError(circular)).toBe('error no serializable')
  })
})
