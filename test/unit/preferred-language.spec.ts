import {
  PreferredLanguage,
  PREFERRED_LANGUAGES,
} from '../../src/domain/value-objects/PreferredLanguage'
import { DomainError } from '../../src/domain/errors/DomainError'

describe('PreferredLanguage', () => {
  it('la lista permitida es exactamente es, en, fr y pt', () => {
    expect(PREFERRED_LANGUAGES).toEqual(['es', 'en', 'fr', 'pt'])
  })

  it.each(['es', 'en', 'fr', 'pt'])('acepta %s tal cual', (language) => {
    expect(PreferredLanguage.create(language).value).toBe(language)
  })

  it.each([
    '',
    ' ',
    'ES',
    ' en ',
    'es-ES',
    'en-US',
    'pt-BR',
    'de',
    'spanish',
    'javascript:alert(1)',
    '<script>',
    '../fr',
  ])('rechaza %j', (language) => {
    expect(() => PreferredLanguage.create(language)).toThrow(DomainError)
  })
})
