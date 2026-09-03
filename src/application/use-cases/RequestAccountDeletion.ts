import { AccountDeletionRequest } from '../../domain/entities/AccountDeletionRequest'
import type { AccountRepositoryPort } from '../ports/AccountRepositoryPort'
import type { AccountDeletionRequestRepositoryPort } from '../ports/AccountDeletionRequestRepositoryPort'
import type { ClockPort } from '../ports/ClockPort'
import type { IdGeneratorPort } from '../ports/IdGeneratorPort'
import {
  AccountAlreadyDeletedError,
  AccountHasActiveDeletionRequestError,
  AccountNotFoundError,
} from '../errors/ApplicationError'
import {
  type AccountDeletionRequestDto,
  toAccountDeletionRequestDto,
} from '../dto/AccountDeletionRequestDto'

export interface RequestAccountDeletionDependencies {
  readonly accounts: AccountRepositoryPort
  readonly deletionRequests: AccountDeletionRequestRepositoryPort
  readonly clock: ClockPort
  readonly ids: IdGeneratorPort
}

/**
 * Solicitud segura de eliminacion de la cuenta propia (HU-43.2).
 *
 * NO ejecuta el derecho al olvido: solo registra, de forma durable, que el
 * titular lo pidio, reutilizando la capacidad de persistencia de HU-43.1
 * (Management #303). El alcance de HU-43 -Account trata sus propios datos,
 * sin coordinar otros bounded contexts- ya esta fijado en EN-011 y ADR-014
 * Decision 5; este caso de uso no lo decide, lo respeta.
 *
 * La identidad SIEMPRE viene de `subject` (el testimonio verificado, resuelto
 * en el controlador desde `VerifiedIdentity`), nunca de un identificador que
 * el cliente aporte: es el mismo patron self-service de `GetOwnAccount` y
 * `UpdateOwnAccount`. Sin eso, cualquier identidad autenticada podria pedir
 * la eliminacion de una cuenta ajena con solo conocer su identificador.
 */
export class RequestAccountDeletion {
  private readonly deps: RequestAccountDeletionDependencies

  constructor(deps: RequestAccountDeletionDependencies) {
    this.deps = deps
  }

  async execute(subject: string): Promise<AccountDeletionRequestDto> {
    const account = await this.deps.accounts.findBySubject(subject)

    if (account === null) {
      throw new AccountNotFoundError(
        subject,
        'El testimonio no tiene ninguna cuenta asociada en este servicio.',
      )
    }

    // HU-43.3: una cuenta ya eliminada (Account.erase()) no tiene nada nuevo
    // que solicitar. Sin esta comprobacion, una segunda llamada tras el
    // cierre crearia una solicitud RECEIVED nueva -la unica activa por
    // cuenta ya se cerro- y reenviaria la notificacion de cierre por cada
    // repeticion.
    if (account.isDeleted) {
      throw new AccountAlreadyDeletedError()
    }

    // Idempotencia (HU-43.2): repetir la solicitud mientras ya hay una activa
    // no debe iniciar un segundo proceso. Se devuelve la misma solicitud, no
    // un error: para el titular, pedir de nuevo lo que ya esta en curso no es
    // un fallo.
    const active = await this.deps.deletionRequests.findActiveByAccountId(account.id)

    if (active !== null) {
      return toAccountDeletionRequestDto(active.toSnapshot())
    }

    const request = AccountDeletionRequest.receive({
      id: this.deps.ids.generate(),
      accountId: account.id,
      // HU-43.3: el correo de la notificacion de cierre se captura AQUI,
      // antes de que el tratamiento pueda anonimizarlo. `Account.erase()`
      // sobrescribe `accounts.email`, y el proceso de cierre debe poder
      // reanudarse tras un reinicio sin depender de un valor que ya fue
      // sobrescrito. Mismo patron que `recovery_challenges.email` (HU-04).
      notifyEmail: account.currentEmail.value,
      occurredAt: this.deps.clock.now(),
    })

    try {
      await this.deps.deletionRequests.save(request)
    } catch (error: unknown) {
      // La comprobacion de arriba no cierra la carrera entre dos peticiones
      // concurrentes del mismo titular: la garantia real es el indice unico
      // parcial de HU-43.1, que `save` traduce a este error. Si eso es lo que
      // ocurrio, la solicitud activa ya existe -la creo la otra peticion-, asi
      // que se recupera y se devuelve igual que el camino idempotente normal,
      // en vez de fallar con un error que confundiria al titular.
      if (error instanceof AccountHasActiveDeletionRequestError) {
        const activeAfterRace = await this.deps.deletionRequests.findActiveByAccountId(account.id)

        if (activeAfterRace !== null) {
          return toAccountDeletionRequestDto(activeAfterRace.toSnapshot())
        }
      }

      throw error
    }

    // Confirmar recepcion SOLO despues de que la persistencia haya
    // funcionado: un fallo de `save` propaga el error hacia arriba y nunca
    // llega hasta aqui, asi que no hay forma de responder "recibida" sin
    // haberla guardado antes.
    return toAccountDeletionRequestDto(request.toSnapshot())
  }
}
