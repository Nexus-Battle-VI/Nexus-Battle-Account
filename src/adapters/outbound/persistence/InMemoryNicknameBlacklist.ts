import type { NicknameBlacklistPort } from '../../../application/ports/NicknameBlacklistPort'

import { NICKNAME_BLACKLIST_SEED } from './nickname-blacklist-seed'

export class InMemoryNicknameBlacklist implements NicknameBlacklistPort {
  private readonly entries: { term: string; active: boolean }[]

  constructor(
    entries: readonly { term: string; active: boolean }[] = NICKNAME_BLACKLIST_SEED.map(
      (entry) => ({
        term: entry.term,
        active: true,
      }),
    ),
  ) {
    this.entries = entries.map((entry) => ({ term: entry.term, active: entry.active }))
  }

  add(term: string, active: boolean): void {
    this.entries.push({ term, active })
  }

  isBlocked(nickname: string): Promise<boolean> {
    const haystack = nickname.toLowerCase()

    return Promise.resolve(
      this.entries.some((entry) => entry.active && haystack.includes(entry.term.toLowerCase())),
    )
  }
}
