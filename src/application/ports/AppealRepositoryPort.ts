import type { Appeal } from '../../domain/entities/Appeal'

export interface AppealRepositoryPort {
  save(appeal: Appeal): Promise<void>
  findById(id: string): Promise<Appeal | null>
  /** Una sancion tiene a lo sumo una apelacion: lo exige `SubmitAppeal`. */
  findBySanctionId(sanctionId: string): Promise<Appeal | null>
  findByAccountId(accountId: string): Promise<readonly Appeal[]>
  /** Apelaciones SUBMITTED, para el panel de revision (Moderador/Admin/SuperAdmin). */
  findPending(): Promise<readonly Appeal[]>
  /**
   * Persiste una resolucion de forma CONDICIONAL: solo escribe si la
   * apelacion seguia en SUBMITTED en el momento de escribir, no en el
   * momento en que `ResolveAppeal` la leyo. Sin esto, dos revisiones
   * concurrentes sobre la MISMA apelacion podrian pasar ambas la
   * comprobacion de lectura (`appeal.isResolved`) y la segunda escritura
   * pisaria silenciosamente la decision de la primera.
   *
   * Devuelve `false` si la apelacion ya no estaba en SUBMITTED -otra
   * revision se adelanto-: quien llama debe tratarlo como un conflicto, no
   * como un exito silencioso.
   */
  saveResolution(appeal: Appeal): Promise<boolean>
}

export const APPEAL_REPOSITORY = Symbol('AppealRepositoryPort')
