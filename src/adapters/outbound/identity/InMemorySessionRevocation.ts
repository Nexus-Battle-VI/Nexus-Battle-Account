import type { SessionRevocationPort } from '../../../application/ports/SessionRevocationPort'

export class InMemorySessionRevocation implements SessionRevocationPort {
  private readonly signedOut = new Set<string>()

  globalSignOut(subject: string): Promise<void> {
    this.signedOut.add(subject)

    return Promise.resolve()
  }

  wasSignedOut(subject: string): boolean {
    return this.signedOut.has(subject)
  }
}
