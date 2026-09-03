import { applyEnvFile, loadConfig } from '../config/env'
import { createLogger } from '../observability/logger'
import { describeError } from '../observability/describe-error'
import { createDatabase } from '../persistence/database'
import { ProcessAccountDeletion } from '../../application/use-cases/ProcessAccountDeletion'
import { PostgresAccountRepository } from '../../adapters/outbound/persistence/PostgresAccountRepository'
import { PostgresAccountDeletionRequestRepository } from '../../adapters/outbound/persistence/PostgresAccountDeletionRequestRepository'
import { LocalAvatarStorage } from '../../adapters/outbound/storage/LocalAvatarStorage'
import { HttpNotificationRequester } from '../../adapters/outbound/messaging/HttpNotificationRequester'
import { LoggingNotificationRequester } from '../../adapters/outbound/messaging/LoggingNotificationRequester'
import { SystemClock } from '../../adapters/outbound/system/SystemClock'
import type { NotificationRequestPort } from '../../application/ports/NotificationRequestPort'

/**
 * Punto de entrada de `npm run process-account-deletions` (HU-43.3, Task
 * Management #305).
 *
 * Mismo patron que `npm run migrate`: un paso explicito de despliegue -aqui,
 * de operacion periodica va cron/scheduler de Infrastructure-, no algo que
 * ocurra al arrancar el servicio ni dentro de una peticion HTTP. HU-43.2 ya
 * separo deliberadamente "recibir la solicitud" de "ejecutar el
 * tratamiento": esta es la mitad que faltaba, y decide CUANDO correr, no
 * este archivo.
 *
 * Exige PostgreSQL: con `PERSISTENCE_DRIVER=memory` cada proceso tiene su
 * propio almacen en memoria, desconectado del proceso HTTP que recibio la
 * solicitud -ejecutar este script no encontraria nunca nada pendiente-.
 */
const main = async (): Promise<void> => {
  applyEnvFile()
  const config = loadConfig(process.env)
  const logger = createLogger({
    level: config.logLevel,
    service: config.serviceName,
    version: config.version,
  })

  if (config.databaseUrl === null) {
    throw new Error('DATABASE_URL es obligatorio para procesar solicitudes de eliminacion.')
  }

  const db = createDatabase({ connectionString: config.databaseUrl })

  try {
    const notifications: NotificationRequestPort =
      config.notificationsIngestUrl === null
        ? new LoggingNotificationRequester(logger)
        : new HttpNotificationRequester({ ingestUrl: config.notificationsIngestUrl, logger })

    const processAccountDeletion = new ProcessAccountDeletion({
      accounts: new PostgresAccountRepository(db),
      requests: new PostgresAccountDeletionRequestRepository(db),
      avatars: new LocalAvatarStorage(config.avatarStoragePath),
      notifications,
      clock: new SystemClock(),
      logger,
    })

    const summary = await processAccountDeletion.execute()

    logger.info('account_deletion_batch_completed', {
      processed: summary.processed,
      closed: summary.closed,
      failed: summary.failed,
    })
  } finally {
    // Sin esto el proceso no termina: el pool mantiene el bucle de eventos vivo.
    await db.destroy()
  }
}

main().catch((error: unknown) => {
  // El registro ya no esta disponible si la configuracion fue lo que fallo, asi
  // que este es el unico sitio donde escribir directamente esta justificado.
  process.stderr.write(`${describeError(error)}\n`)
  process.exitCode = 1
})
