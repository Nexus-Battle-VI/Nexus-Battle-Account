export interface SecurityQuestion {
  readonly id: string
  readonly statement: string
}

export interface SecurityQuestionCatalogPort {
  listActive(): Promise<readonly SecurityQuestion[]>
}

export const SECURITY_QUESTION_CATALOG = Symbol('SecurityQuestionCatalogPort')
