import type {
  NotificationRequest,
  NotificationRequestPort,
} from '../../../application/ports/NotificationRequestPort'
import type { Logger } from '../../../infrastructure/observability/logger'

/**
 * Publica la solicitud de notificacion hacia el ingest local de Notifications.
 *
 * Solo para desarrollo: el worker no expone API de negocio en produccion.
 * Si el ingest no responde, se registra el fallo y no se interrumpe el caso
 * de uso (el codigo de recuperacion ya quedo emitido).
 */
export class HttpNotificationRequester implements NotificationRequestPort {
  constructor(
    private readonly deps: {
      readonly ingestUrl: string
      readonly logger: Logger
    },
  ) {}

  async request(notification: NotificationRequest): Promise<void> {
    this.deps.logger.info('notification_requested', {
      notificationId: notification.notificationId,
      templateId: notification.templateId,
      recipientDomain: notification.recipient.split('@')[1] ?? 'desconocido',
    })

    try {
      const response = await fetch(this.deps.ingestUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(notification),
      })

      if (!response.ok) {
        this.deps.logger.warn('notification_ingest_rejected', {
          templateId: notification.templateId,
          status: response.status,
        })
      }
    } catch (error: unknown) {
      this.deps.logger.warn('notification_ingest_failed', {
        templateId: notification.templateId,
        reason: error instanceof Error ? error.message : 'Fallo desconocido',
      })
    }
  }
}
