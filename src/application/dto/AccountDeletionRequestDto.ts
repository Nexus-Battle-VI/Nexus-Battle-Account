import type { AccountDeletionRequestSnapshot } from '../../domain/entities/AccountDeletionRequest'

/**
 * Representacion de una solicitud de eliminacion hacia el exterior (HU-43.2).
 *
 * Deliberadamente NO incluye `accountId`: quien pregunta ya es el titular
 * -la identidad viene del testimonio, nunca de un identificador que el
 * cliente aporte- y repetirlo en la respuesta no añade nada. Tampoco incluye
 * `closedAt`: esta Task solo confirma RECEPCION, nunca cierre.
 */
export interface AccountDeletionRequestDto {
  readonly id: string
  readonly status: string
  readonly receivedAt: string
}

export const toAccountDeletionRequestDto = (
  snapshot: AccountDeletionRequestSnapshot,
): AccountDeletionRequestDto => ({
  id: snapshot.id,
  status: snapshot.status,
  receivedAt: snapshot.receivedAt,
})
