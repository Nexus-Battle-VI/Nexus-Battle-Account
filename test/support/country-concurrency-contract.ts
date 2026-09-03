import type { AccountRepositoryPort } from '../../src/application/ports/AccountRepositoryPort'
import { AssignRole } from '../../src/application/use-cases/AssignRole'
import { UpdateOwnAccount } from '../../src/application/use-cases/UpdateOwnAccount'
import { CountryCode } from '../../src/domain/value-objects/CountryCode'
import { DisplayName } from '../../src/domain/value-objects/DisplayName'
import { Role } from '../../src/domain/entities/Role'
import { buildActiveAccount } from './account-factory'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

export const countryConcurrencyContract = (getAccounts: () => AccountRepositoryPort): void => {
  it.each([
    [null, 'CO'],
    ['CO', null],
  ] as const)(
    'un admin que leyo %s no revierte PATCH pais %s mientras espera MFA',
    async (initial, desired) => {
      const accounts = getAccounts()
      const actor = buildActiveAccount({
        id: 'country-actor',
        subject: 'actor-country',
        email: 'actor-country@example.test',
        displayName: 'Actor Country',
        roles: [Role.SuperAdministrator],
      })
      const target = buildActiveAccount({
        id: 'country-target',
        subject: 'target-country',
        email: 'target-country@example.test',
        displayName: 'Target Country',
      })
      if (initial !== null) target.changeCountryCode(CountryCode.create(initial))
      await accounts.save(actor)
      await accounts.save(target)
      const entered = deferred(),
        release = deferred()
      const reflect = jest
        .fn<Promise<void>, [string, readonly Role[]]>()
        .mockResolvedValue(undefined)
      const assign = new AssignRole(
        accounts,
        { reflect },
        {
          hasConfirmedTotp: () => {
            entered.resolve()
            return release.promise.then(() => true)
          },
        },
      )
      const assigning = assign.execute({
        actorSubject: actor.subject,
        targetAccountId: target.id.value,
        role: Role.Administrator,
      })
      await entered.promise
      const update = new UpdateOwnAccount(accounts, { isBlocked: () => Promise.resolve(false) })
      await update.execute({ subject: target.subject, countryCode: desired })
      release.resolve()
      const result = await assigning
      expect(result.kind).toBe('assigned')
      if (result.kind !== 'assigned') throw new Error('No se asigno rol')
      expect(result.account.countryCode).toBe(desired)
      const persisted = (await accounts.findById(target.id))!
      expect(persisted.currentCountryCode?.value ?? null).toBe(desired)
      expect(persisted.currentRoles).toEqual(
        expect.arrayContaining([Role.Player, Role.Administrator]),
      )
      expect(persisted.currentDisplayName.value).toBe('Target Country')
      expect(reflect).toHaveBeenCalledWith(
        target.subject,
        expect.arrayContaining([Role.Player, Role.Administrator]),
      )
    },
  )

  it('renombrar con pais omitido conserva PATCH concurrente y devuelve DTO actualizado', async () => {
    const accounts = getAccounts()
    const target = buildActiveAccount({
      id: 'country-rename',
      subject: 'rename-country',
      email: 'rename-country@example.test',
      displayName: 'Nombre Inicial',
    })
    await accounts.save(target)
    const entered = deferred(),
      release = deferred()
    const rename = new UpdateOwnAccount(accounts, {
      isBlocked: () => {
        entered.resolve()
        return release.promise.then(() => false)
      },
    })
    const renaming = rename.execute({ subject: target.subject, displayName: 'Nombre Nuevo' })
    await entered.promise
    await new UpdateOwnAccount(accounts, { isBlocked: () => Promise.resolve(false) }).execute({
      subject: target.subject,
      countryCode: 'CO',
    })
    release.resolve()
    expect(await renaming).toMatchObject({ displayName: 'Nombre Nuevo', countryCode: 'CO' })
    expect((await accounts.findById(target.id))!.toSnapshot()).toMatchObject({
      displayName: 'Nombre Nuevo',
      countryCode: 'CO',
    })
  })

  it('null explicito se escribe incluso si la lectura previa tenia null y cambia mientras valida apodo', async () => {
    const accounts = getAccounts()
    const target = buildActiveAccount({
      id: 'country-null',
      subject: 'null-country',
      email: 'null-country@example.test',
      displayName: 'Nombre Null',
    })
    await accounts.save(target)
    const entered = deferred(),
      release = deferred()
    const mixed = new UpdateOwnAccount(accounts, {
      isBlocked: () => {
        entered.resolve()
        return release.promise.then(() => false)
      },
    })
    const changing = mixed.execute({
      subject: target.subject,
      displayName: 'Nombre Borrado',
      countryCode: null,
    })
    await entered.promise
    await new UpdateOwnAccount(accounts, { isBlocked: () => Promise.resolve(false) }).execute({
      subject: target.subject,
      countryCode: 'CO',
    })
    release.resolve()
    expect(await changing).toMatchObject({ displayName: 'Nombre Borrado', countryCode: null })
    expect((await accounts.findById(target.id))!.currentCountryCode).toBeNull()
  })

  it('un cambio de pais ya guardado no vuelve a escribirse al reutilizar la instancia', async () => {
    const accounts = getAccounts()
    const target = buildActiveAccount({
      id: 'country-reused',
      subject: 'reused-country',
      email: 'reused-country@example.test',
      displayName: 'Nombre Reusado',
    })
    target.changeCountryCode(CountryCode.create('CO'))
    await accounts.save(target)
    const update = new UpdateOwnAccount(accounts, { isBlocked: () => Promise.resolve(false) })
    await update.execute({ subject: target.subject, countryCode: 'US' })
    target.rename(DisplayName.create('Nombre Modificado'))
    await accounts.save(target)
    expect(target.currentCountryCode?.value).toBe('US')
    expect((await accounts.findById(target.id))!.currentCountryCode?.value).toBe('US')
    await update.execute({ subject: target.subject, countryCode: null })
    target.rename(DisplayName.create('Nombre Final'))
    await accounts.save(target)
    expect(target.currentCountryCode).toBeNull()
    expect((await accounts.findById(target.id))!.toSnapshot()).toMatchObject({
      displayName: 'Nombre Final',
      countryCode: null,
    })
  })
}
