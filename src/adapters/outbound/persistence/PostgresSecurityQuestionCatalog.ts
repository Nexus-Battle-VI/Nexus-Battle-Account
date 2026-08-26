import type { Kysely } from 'kysely'

import type {
  SecurityQuestion,
  SecurityQuestionCatalogPort,
} from '../../../application/ports/SecurityQuestionCatalogPort'
import type { Database } from './schema'

export class PostgresSecurityQuestionCatalog implements SecurityQuestionCatalogPort {
  private readonly db: Kysely<Database>

  constructor(db: Kysely<Database>) {
    this.db = db
  }

  async listActive(): Promise<readonly SecurityQuestion[]> {
    return this.db
      .selectFrom('security_questions')
      .select(['id', 'statement'])
      .where('active', '=', true)
      .execute()
  }
}
