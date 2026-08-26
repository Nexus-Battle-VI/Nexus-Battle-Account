import type { NicknameBlacklistPort } from '../../../application/ports/NicknameBlacklistPort'

export class InMemoryNicknameBlacklist implements NicknameBlacklistPort {
  private readonly entries: { term: string; active: boolean }[] = []

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
