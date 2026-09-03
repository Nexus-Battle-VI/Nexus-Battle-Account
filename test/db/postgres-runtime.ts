import { randomBytes } from 'node:crypto'
import { Pool } from 'pg'
import { PostgreSqlContainer } from '@testcontainers/postgresql'

export interface TestPostgres {
  getConnectionUri(): string
  stop(): Promise<unknown>
}
/** Both modes run a real engine. Native mode owns one random local database. */
export const startTestPostgres = async (): Promise<TestPostgres> => {
  const supplied = process.env.POSTGRES_TEST_URL
  if (supplied === undefined) return new PostgreSqlContainer('postgres:17-alpine').start()
  const url = new URL(supplied)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw new Error('POSTGRES_TEST_URL debe apuntar al motor local de pruebas.')
  const admin = new Pool({ connectionString: supplied, max: 1 })
  const name = `account_test_${randomBytes(10).toString('hex')}`
  await admin.query(`CREATE DATABASE "${name}"`)
  url.pathname = '/' + name
  return {
    getConnectionUri: () => url.toString(),
    stop: async () => {
      try {
        await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`)
      } finally {
        await admin.end()
      }
    },
  }
}
