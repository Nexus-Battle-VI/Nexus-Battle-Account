import type {
  NotificationRequest,
  NotificationRequestPort,
} from '../../../application/ports/NotificationRequestPort'
import type { Logger } from '../../../infrastructure/observability/logger'

/**
 * Adaptador de solicitud de notificaciones para el alcance de Foundation.
 *
 * Registra la solicitud en la observabilidad con la forma exacta del mensaje
 * que consumira el contexto Notifications. La publicacion real hacia una cola
 * queda sujeta a ADR-006; no se simula un envio que no ocurre.
 */
export class LoggingNotificationRequester implements NotificationRequestPort {
  private readonly logger: Logger

  constructor(logger: Logger) {
    this.logger = logger
  }

  request(notification: NotificationRequest): Promise<void> {
    this.logger.info('notification_requested', {
      notificationId: notification.notificationId,
      templateId: notification.templateId,
      // El destinatario es un dato personal: se registra el dominio, no la
      // direccion completa.
      recipientDomain: notification.recipient.split('@')[1] ?? 'desconocido',
    })

    return Promise.resolve()
  }
}
