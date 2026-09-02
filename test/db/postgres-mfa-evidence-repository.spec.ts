import 'reflect-metadata'

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { sql, type Kysely } from 'kysely'

import { PostgresMfaEvidenceRepository } from '../../src/adapters/outbound/persistence/PostgresMfaEvidenceRepository'
import * as evidenceMigration from '../../src/adapters/outbound/persistence/migrations/hu33-mfa-evidence'
import * as methodMigration from '../../src/adapters/outbound/persistence/migrations/hu33-mfa-evidence-method'
import type { Database } from '../../src/adapters/outbound/persistence/schema'
import { MfaEvidence } from '../../src/domain/entities/MfaEvidence'
import { SecondFactorMethod } from '../../src/domain/entities/SecondFactorMethod'
import { createDatabase } from '../../src/infrastructure/persistence/database'

describe('PostgresMfaEvidenceRepository', () => {
  let container: StartedPostgreSqlContainer
  let db: Kysely<Database>
  let repository: PostgresMfaEvidenceRepository

  const VERIFIED_AT = new Date('2026-09-02T05:00:00.000Z')
  const EXPIRES_AT = new Date('2026-09-02T05:15:00.000Z')

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start()
    db = createDatabase({ connectionString: container.getConnectionUri() })

    await evidenceMigration.up(db as unknown as Kysely<unknown>)
    await sql`
      insert into mfa_evidences (subject, jti, expires_at, verified_at)
      values ('legacy-subject', 'legacy-jti', ${EXPIRES_AT}, ${VERIFIED_AT})
    `.execute(db)
    await methodMigration.up(db as unknown as Kysely<unknown>)

    repository = new PostgresMfaEvidenceRepository(db)
  }, 120_000)

  afterAll(async () => {
    await methodMigration.down(db as unknown as Kysely<unknown>)
    await evidenceMigration.down(db as unknown as Kysely<unknown>)
    await db.destroy()
    await container.stop()
  })

  it('invalida evidencias anteriores cuyo metodo era desconocido', async () => {
    const result = await sql<{ total: string }>`
      select count(*)::text as total from mfa_evidences where subject = 'legacy-subject'
    `.execute(db)

    expect(Number(result.rows[0]?.total)).toBe(0)
  })

  it('solo valida la evidencia para el metodo que realmente se completo', async () => {
    await repository.save(
      MfaEvidence.create({
        subject: 'totp-subject',
        jti: 'totp-jti',
        method: SecondFactorMethod.AuthenticatorApp,
        verifiedAt: VERIFIED_AT,
        expiresAt: EXPIRES_AT,
      }),
    )

    const beforeExpiry = new Date('2026-09-02T05:14:00.000Z')

    await expect(
      repository.isValidFor(
        'totp-subject',
        'totp-jti',
        SecondFactorMethod.AuthenticatorApp,
        beforeExpiry,
      ),
    ).resolves.toBe(true)
    await expect(
      repository.isValidFor('totp-subject', 'totp-jti', SecondFactorMethod.Email, beforeExpiry),
    ).resolves.toBe(false)
  })

  it('no valida una evidencia vencida', async () => {
    await repository.save(
      MfaEvidence.create({
        subject: 'expired-subject',
        jti: 'expired-jti',
        method: SecondFactorMethod.AuthenticatorApp,
        verifiedAt: VERIFIED_AT,
        expiresAt: EXPIRES_AT,
      }),
    )

    await expect(
      repository.isValidFor(
        'expired-subject',
        'expired-jti',
        SecondFactorMethod.AuthenticatorApp,
        EXPIRES_AT,
      ),
    ).resolves.toBe(false)
  })

  it('actualiza el metodo al guardar de nuevo el mismo sujeto y jti', async () => {
    const common = {
      subject: 'retry-subject',
      jti: 'retry-jti',
      verifiedAt: VERIFIED_AT,
      expiresAt: EXPIRES_AT,
    }

    await repository.save(
      MfaEvidence.create({ ...common, method: SecondFactorMethod.AuthenticatorApp }),
    )
    await repository.save(MfaEvidence.create({ ...common, method: SecondFactorMethod.Sms }))

    const beforeExpiry = new Date('2026-09-02T05:14:00.000Z')
    await expect(
      repository.isValidFor(
        common.subject,
        common.jti,
        SecondFactorMethod.AuthenticatorApp,
        beforeExpiry,
      ),
    ).resolves.toBe(false)
    await expect(
      repository.isValidFor(common.subject, common.jti, SecondFactorMethod.Sms, beforeExpiry),
    ).resolves.toBe(true)
  })

  it('impide persistir un metodo fuera del vocabulario aprobado', async () => {
    await expect(
      sql`
        insert into mfa_evidences (subject, jti, method, expires_at, verified_at)
        values ('invalid-subject', 'invalid-jti', 'PUSH_NOTIFICATION', ${EXPIRES_AT}, ${VERIFIED_AT})
      `.execute(db),
    ).rejects.toThrow()
  })

  it('exige el metodo en cada evidencia', async () => {
    await expect(
      sql`
        insert into mfa_evidences (subject, jti, expires_at, verified_at)
        values ('missing-subject', 'missing-jti', ${EXPIRES_AT}, ${VERIFIED_AT})
      `.execute(db),
    ).rejects.toThrow()
  })
})
