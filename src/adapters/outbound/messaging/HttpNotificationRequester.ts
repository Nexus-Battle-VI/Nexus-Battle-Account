import type {
  NotificationRequest,
  NotificationRequestPort,
} from '../../../application/ports/NotificationRequestPort'
import type { Logger } from '../../../infrastructure/observability/logger'

/**
 * Publica la solicitud de notificacion hacia el ingest de Notifications.
 *
 * El ingest existe desde que ADR-006 se resolvio a favor de la ingesta HTTP:
 * Notifications levanta un servidor dedicado con `INGEST_ENABLED=true`, sin
 * publicar puerto al anfitrion, de modo que solo es alcanzable desde la red
 * interna. Se activa aqui definiendo `NOTIFICATIONS_INGEST_URL`; sin esa
 * variable se sigue usando `LoggingNotificationRequester`.
 *
 * LOS FALLOS SE TRAGAN A PROPOSITO: si el ingest no responde, se registra y el
 * caso de uso continua. Un registro no debe fracasar porque el correo falle, y
 * el codigo de recuperacion ya quedo emitido y persistido. La contrapartida es
 * que **un fallo de entrega no se ve en la respuesta HTTP**: se ve en el log,
 * como `notification_ingest_rejected` o `notification_ingest_failed`.
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
