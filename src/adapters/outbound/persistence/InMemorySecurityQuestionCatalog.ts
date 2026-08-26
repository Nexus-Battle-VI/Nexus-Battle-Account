import type {
  SecurityQuestion,
  SecurityQuestionCatalogPort,
} from '../../../application/ports/SecurityQuestionCatalogPort'
import { SECURITY_QUESTION_SEED } from './security-question-seed'

export class InMemorySecurityQuestionCatalog implements SecurityQuestionCatalogPort {
  private readonly questions: SecurityQuestion[]

  constructor(questions: readonly SecurityQuestion[] = SECURITY_QUESTION_SEED) {
    this.questions = [...questions]
  }

  listActive(): Promise<readonly SecurityQuestion[]> {
    return Promise.resolve(this.questions)
  }
}
