import 'reflect-metadata'

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { Kysely } from 'kysely'

import { describeError } from '../../src/infrastructure/observability/describe-error'
import { createDatabase, migrateToLatest } from '../../src/infrastructure/persistence/database'
import { PostgresAccountRepository } from '../../src/adapters/outbound/persistence/PostgresAccountRepository'
import { PostgresRecoveryChallengeRepository } from '../../src/adapters/outbound/persistence/PostgresRecoveryChallengeRepository'
import type { Database } from '../../src/adapters/outbound/persistence/schema'
import { RecoveryChallenge } from '../../src/domain/entities/RecoveryChallenge'
import { buildAccount } from '../support/account-factory'

/**
 * Adaptador de PostgreSQL contra un motor REAL, en contenedor.
 *
 * Vive aparte de la suite por defecto por lo mismo que
 * `postgres-account-repository.spec.ts`: necesita Docker, y comprueba algo
 * que un doble en memoria no puede -que el SQL sea valido y que las
 * restricciones existan de verdad.
 */
describe('PostgresRecoveryChallengeRepository', () => {
  let container: StartedPostgreSqlContainer
  let db: Kysely<Database>
  let repository: PostgresRecoveryChallengeRepository

  const AT = new Date('2026-08-31T12:00:00.000Z')
  let contador = 0

  const nextToken = (): string => {
    contador += 1

    return `rec-${String(contador)}`
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start()
    db = createDatabase({ connectionString: container.getConnectionUri() })

    const { error } = await migrateToLatest(db)

    if (error !== undefined) {
      throw new Error(`Las migraciones fallaron: ${describeError(error)}`)
    }

    const accounts = new PostgresAccountRepository(db)
    await accounts.save(
      buildAccount({
        id: 'acc-1',
        email: 'jugador@nexus.test',
        displayName: 'Jugador Uno',
      }),
    )
    await accounts.save(
      buildAccount({
        id: 'acc-2',
        email: 'jugador2@nexus.test',
        displayName: 'Jugador Dos',
      }),
    )
  }, 120_000)

  afterAll(async () => {
    await db.destroy()
    await container.stop()
  })

  beforeEach(() => {
    repository = new PostgresRecoveryChallengeRepository(db)
  })

  it('guarda y recupera un desafio sin cuenta asociada (correo no registrado)', async () => {
    const token = nextToken()
    const challenge = RecoveryChallenge.start({
      token,
      email: 'nadie@nexus.test',
      accountId: null,
      occurredAt: AT,
    })

    await repository.save(challenge)
    const found = await repository.findByToken(token)

    expect(found?.toSnapshot()).toEqual(challenge.toSnapshot())
  })

  it('avanza de etapa y persiste el resumen del codigo, nunca el codigo en claro', async () => {
    const token = nextToken()
    const challenge = RecoveryChallenge.start({
      token,
      email: 'jugador@nexus.test',
      accountId: 'acc-1',
      occurredAt: AT,
    })
    await repository.save(challenge)

    challenge.markQuestionsVerified('hash-del-codigo')
    await repository.save(challenge)

    const found = await repository.findByToken(token)

    expect(found?.currentStage).toBe('QUESTIONS_VERIFIED')
    expect(found?.currentCodeHash).toBe('hash-del-codigo')
  })

  it('deja el resumen del codigo en null al consumirlo (un solo uso)', async () => {
    const token = nextToken()
    const challenge = RecoveryChallenge.start({
      token,
      email: 'jugador2@nexus.test',
      accountId: 'acc-2',
      occurredAt: AT,
    })
    challenge.markQuestionsVerified('hash-del-codigo')
    await repository.save(challenge)

    challenge.markCodeVerified()
    await repository.save(challenge)

    const found = await repository.findByToken(token)

    expect(found?.currentStage).toBe('CODE_VERIFIED')
    expect(found?.currentCodeHash).toBeNull()
  })

  it('devuelve null cuando el token no existe', async () => {
    expect(await repository.findByToken('token-inexistente')).toBeNull()
  })
})
