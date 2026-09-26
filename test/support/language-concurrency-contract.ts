import type { AccountRepositoryPort } from '../../src/application/ports/AccountRepositoryPort'
import { UpdateOwnAccount } from '../../src/application/use-cases/UpdateOwnAccount'
import { DisplayName } from '../../src/domain/value-objects/DisplayName'
import { PreferredLanguage } from '../../src/domain/value-objects/PreferredLanguage'
import { buildActiveAccount } from './account-factory'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

/**
 * El idioma sigue el mismo control de intencion que el pais: un guardado que no
 * pretendia cambiarlo -con una lectura anterior- no lo revierte.
 */
export const languageConcurrencyContract = (getAccounts: () => AccountRepositoryPort): void => {
  it('renombrar con idioma omitido conserva un PATCH de idioma concurrente', async () => {
    const accounts = getAccounts()
    const target = buildActiveAccount({
      id: 'language-rename',
      subject: 'rename-language',
      email: 'rename-language@example.test',
      displayName: 'Nombre Idioma',
    })
    await accounts.save(target)
    const entered = deferred(),
      release = deferred()
    const renaming = new UpdateOwnAccount(accounts, {
      isBlocked: () => {
        entered.resolve()
        return release.promise.then(() => false)
      },
    }).execute({ subject: target.subject, displayName: 'Nombre Idioma Nuevo' })
    await entered.promise
    await new UpdateOwnAccount(accounts, { isBlocked: () => Promise.resolve(false) }).execute({
      subject: target.subject,
      preferredLanguage: 'fr',
    })
    release.resolve()
    expect(await renaming).toMatchObject({
      displayName: 'Nombre Idioma Nuevo',
      preferredLanguage: 'fr',
    })
    expect((await accounts.findById(target.id))!.toSnapshot()).toMatchObject({
      displayName: 'Nombre Idioma Nuevo',
      preferredLanguage: 'fr',
    })
  })

  it('cambiar solo el idioma con una lectura anterior no pisa un pais guardado mientras tanto', async () => {
    const accounts = getAccounts()
    const target = buildActiveAccount({
      id: 'language-country',
      subject: 'country-language',
      email: 'country-language@example.test',
      displayName: 'Nombre Pais Idioma',
    })
    await accounts.save(target)
    const stale = (await accounts.findById(target.id))!
    await new UpdateOwnAccount(accounts, { isBlocked: () => Promise.resolve(false) }).execute({
      subject: target.subject,
      countryCode: 'CO',
    })
    stale.changePreferredLanguage(PreferredLanguage.create('pt'))
    await accounts.save(stale)
    expect((await accounts.findById(target.id))!.toSnapshot()).toMatchObject({
      countryCode: 'CO',
      preferredLanguage: 'pt',
    })
  })

  it('un idioma ya guardado no vuelve a escribirse al reutilizar la instancia', async () => {
    const accounts = getAccounts()
    const target = buildActiveAccount({
      id: 'language-reused',
      subject: 'reused-language',
      email: 'reused-language@example.test',
      displayName: 'Nombre Reusado Idioma',
    })
    target.changePreferredLanguage(PreferredLanguage.create('en'))
    await accounts.save(target)
    await new UpdateOwnAccount(accounts, { isBlocked: () => Promise.resolve(false) }).execute({
      subject: target.subject,
      preferredLanguage: 'es',
    })
    target.rename(DisplayName.create('Nombre Reusado Final'))
    await accounts.save(target)
    expect(target.currentPreferredLanguage?.value).toBe('es')
    expect((await accounts.findById(target.id))!.toSnapshot()).toMatchObject({
      displayName: 'Nombre Reusado Final',
      preferredLanguage: 'es',
    })
  })
}
