import { CountryCode } from '../../src/domain/value-objects/CountryCode'
import { DomainError } from '../../src/domain/errors/DomainError'

describe('CountryCode', () => {
  it.each(['CO', 'US', 'ES', 'DE', 'BR', 'JP', 'GB', 'FR', 'AX', 'PS'])(
    'acepta el país asignado %s',
    (country) => {
      expect(CountryCode.create(` ${country.toLowerCase()} `).value).toBe(country)
    },
  )
  it.each(['', 'ZZ', 'XX', 'USA', 'Colombia', 'C0', 'UK', 'EU', 'XK', 'ß'])(
    'rechaza código no asignado %s',
    (country) => {
      expect(() => CountryCode.create(country)).toThrow(DomainError)
    },
  )
})
