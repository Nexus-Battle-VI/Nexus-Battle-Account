import type { MfaStatusPort } from '../../../application/ports/MfaStatusPort'

export class InMemoryMfaStatus implements MfaStatusPort {
  private readonly subjects = new Set<string>()

  constructor(subjects: Iterable<string> = []) {
    for (const subject of subjects) {
      this.subjects.add(subject)
    }
  }

  hasConfirmedTotp(subject: string): Promise<boolean> {
    return Promise.resolve(this.subjects.has(subject))
  }

  confirm(subject: string): void {
    this.subjects.add(subject)
  }
}
