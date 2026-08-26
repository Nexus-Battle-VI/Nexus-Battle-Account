/**
 * Lista negra vigente de apodos.
 *
 * Los terminos viven en persistencia (`nickname_blacklist_entries`), no en
 * TypeScript. Solo cuentan los registros con `active = true`.
 */
export interface NicknameBlacklistPort {
  isBlocked(nickname: string): Promise<boolean>
}

export const NICKNAME_BLACKLIST = Symbol('NicknameBlacklistPort')
