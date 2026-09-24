import { InMemoryAccountRepository } from '../../src/adapters/outbound/persistence/InMemoryAccountRepository'
import { languageConcurrencyContract } from '../support/language-concurrency-contract'

describe('Idioma preferido bajo escrituras concurrentes en memoria', () => {
  let accounts: InMemoryAccountRepository
  beforeEach(() => {
    accounts = new InMemoryAccountRepository()
  })
  languageConcurrencyContract(() => accounts)
})
