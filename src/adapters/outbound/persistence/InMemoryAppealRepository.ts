import type { AppealRepositoryPort } from '../../../application/ports/AppealRepositoryPort'
import { Appeal, type AppealSnapshot } from '../../../domain/entities/Appeal'
import { AppealStatus } from '../../../domain/entities/AppealStatus'

/**
 * Guarda SNAPSHOTS, no la instancia `Appeal` en vivo.
 *
 * Es deliberado: `appeal.resolve(...)` muta el objeto en el sitio. Si este
 * almacen guardara la referencia tal cual, `saveResolution` comprobaria el
 * estado "antes de escribir" sobre el MISMO objeto que quien llama acaba de
 * mutar -siempre lo veria ya resuelto, aunque la base real nunca hubiera
 * recibido esa escritura-. Guardar una foto en cada `save`/`saveResolution`
 * y reconstruir con `Appeal.restore()` en cada lectura reproduce la misma
 * semantica que Postgres, donde cada fila leida es, por definicion, una
 * instancia nueva.
 */
export class InMemoryAppealRepository implements AppealRepositoryPort {
  private readonly appeals = new Map<string, AppealSnapshot>()

  save(appeal: Appeal): Promise<void> {
    this.appeals.set(appeal.id, appeal.toSnapshot())

    return Promise.resolve()
  }

  saveResolution(appeal: Appeal): Promise<boolean> {
    const current = this.appeals.get(appeal.id)

    if (current?.status !== AppealStatus.Submitted) {
      return Promise.resolve(false)
    }

    this.appeals.set(appeal.id, appeal.toSnapshot())

    return Promise.resolve(true)
  }

  findById(id: string): Promise<Appeal | null> {
    const snapshot = this.appeals.get(id)

    return Promise.resolve(snapshot === undefined ? null : Appeal.restore(snapshot))
  }

  findBySanctionId(sanctionId: string): Promise<Appeal | null> {
    const snapshot = [...this.appeals.values()].find(
      (candidate) => candidate.sanctionId === sanctionId,
    )

    return Promise.resolve(snapshot === undefined ? null : Appeal.restore(snapshot))
  }

  findByAccountId(accountId: string): Promise<readonly Appeal[]> {
    const appeals = [...this.appeals.values()]
      .filter((snapshot) => snapshot.accountId === accountId)
      .sort((left, right) => right.submittedAt.getTime() - left.submittedAt.getTime())
      .map((snapshot) => Appeal.restore(snapshot))

    return Promise.resolve(appeals)
  }

  findPending(): Promise<readonly Appeal[]> {
    const appeals = [...this.appeals.values()]
      .filter((snapshot) => snapshot.status === AppealStatus.Submitted)
      .sort((left, right) => left.submittedAt.getTime() - right.submittedAt.getTime())
      .map((snapshot) => Appeal.restore(snapshot))

    return Promise.resolve(appeals)
  }

  findAll(): readonly Appeal[] {
    return [...this.appeals.values()].map((snapshot) => Appeal.restore(snapshot))
  }
}
