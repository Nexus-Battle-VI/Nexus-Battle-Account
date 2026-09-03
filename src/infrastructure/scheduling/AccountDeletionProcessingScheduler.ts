import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common'

import type { AccountDeletionRequestRepositoryPort } from '../../application/ports/AccountDeletionRequestRepositoryPort'
import type { ProcessAccountDeletion } from '../../application/use-cases/ProcessAccountDeletion'
import type { Logger } from '../observability/logger'
import { describeError } from '../observability/describe-error'

export interface AccountDeletionProcessingSchedulerOptions {
  readonly enabled: boolean
  readonly intervalMs: number
  readonly deletionRequests: AccountDeletionRequestRepositoryPort
  readonly processAccountDeletion: ProcessAccountDeletion
  readonly logger: Logger
}

/**
 * Tope defensivo por pasada. Un backlog mayor lo drena la pasada siguiente:
 * esto evita que una acumulacion grande bloquee el bucle de eventos en una
 * sola ejecucion del temporizador, no impone un limite de negocio.
 */
const MAX_CLAIMS_PER_TICK = 20

/**
 * Ejecucion en segundo plano del tratamiento durable de HU-43 (HU-43.3,
 * Management Task #305).
 *
 * Account no tenia, antes de esta Task, ningun mecanismo de trabajo
 * asincrono/durable propio -sin worker dedicado, sin cron, sin cola-. ADR-014
 * deja explicitamente el mecanismo concreto ("tabla de estado, job
 * periodico, u otro") como decision de IMPLEMENTACION de HU-43, no del ADR.
 * Se elige un intervalo dentro del propio proceso (`setInterval`) por ser la
 * opcion minima compatible con el repositorio: no anade una dependencia
 * nueva, no requiere una cola ni un servicio adicional, y corre dentro del
 * mismo proceso HTTP que ya existe -ni Terraform, ni Docker, ni SQS nuevos.
 *
 * Apagado por defecto (`ACCOUNT_DELETION_PROCESSING_ENABLED=false`, mismo
 * patron que `NOTIFICATIONS_INGEST_URL`): un entorno que no lo activa
 * explicitamente no trata datos personales en segundo plano por sorpresa.
 *
 * LIMITACION CONOCIDA: es una cola FIFO simple sin cola de mensajes fallidos
 * propia. `claimNextPending` siempre reclama la solicitud PENDIENTE mas
 * antigua; una solicitud que falla en todos los intentos permanece a la
 * cabeza (no se cierra) y puede monopolizar `MAX_CLAIMS_PER_TICK` intentos en
 * cada pasada, retrasando a las demas mientras tanto. HU-43 no define una
 * politica de reintentos con backoff ni una cola de mensajes fallidos propia
 * para este proceso, asi que no se inventa una aqui; queda documentado como
 * riesgo operativo en el PR de HU-43.3.
 */
export class AccountDeletionProcessingScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly options: AccountDeletionProcessingSchedulerOptions
  private timer: NodeJS.Timeout | null = null

  constructor(options: AccountDeletionProcessingSchedulerOptions) {
    this.options = options
  }

  onModuleInit(): void {
    if (!this.options.enabled) {
      this.options.logger.info('account_deletion_processing_disabled', {})

      return
    }

    this.options.logger.info('account_deletion_processing_started', {
      intervalMs: this.options.intervalMs,
    })

    this.timer = setInterval(() => {
      void this.tick()
    }, this.options.intervalMs)

    // No debe ser lo unico que mantenga vivo el proceso: un cierre ordenado
    // no tiene por que esperar a la siguiente pasada del temporizador.
    this.timer.unref()
  }

  onModuleDestroy(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /**
   * Publico para poder ejercitarlo directamente en pruebas, sin esperar al
   * temporizador real. Devuelve cuantas solicitudes proceso en esta pasada.
   */
  async tick(): Promise<number> {
    let processed = 0

    for (let attempt = 0; attempt < MAX_CLAIMS_PER_TICK; attempt += 1) {
      const claimed = await this.options.deletionRequests.claimNextPending()

      if (claimed === null) {
        break
      }

      try {
        await this.options.processAccountDeletion.execute(claimed)
      } catch (error: unknown) {
        // El fallo de UNA solicitud no debe abortar el resto del lote: la
        // siguiente pasada (o `claimNextPending` en un reintento posterior)
        // se ocupara de ella.
        this.options.logger.error('account_deletion_processing_tick_failed', {
          requestId: claimed.id,
          reason: describeError(error),
        })
      }

      processed += 1
    }

    return processed
  }
}
