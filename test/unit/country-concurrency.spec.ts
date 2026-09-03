import { InMemoryAccountRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountRepository'
import { countryConcurrencyContract } from '../support/country-concurrency-contract'

describe('Pais del perfil bajo escrituras concurrentes en memoria', () => {
  let accounts: InMemoryAccountRepository
  beforeEach(() => {
    accounts = new InMemoryAccountRepository()
  })
  countryConcurrencyContract(() => accounts)
})
