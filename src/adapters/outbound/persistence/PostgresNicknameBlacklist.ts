import type { Kysely } from 'kysely'

import type { NicknameBlacklistPort } from '../../../application/ports/NicknameBlacklistPort'
import type { Database } from './schema'

export class PostgresNicknameBlacklist implements NicknameBlacklistPort {
  private readonly db: Kysely<Database>

  constructor(db: Kysely<Database>) {
    this.db = db
  }

  async isBlocked(nickname: string): Promise<boolean> {
    const haystack = nickname.toLowerCase()
    const entries = await this.db
      .selectFrom('nickname_blacklist_entries')
      .select('term')
      .where('active', '=', true)
      .execute()

    return entries.some((entry) => haystack.includes(entry.term.toLowerCase()))
  }
}
