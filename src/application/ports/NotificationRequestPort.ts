/**
 * Puerto de solicitud de notificaciones.
 *
 * Account no envia correo: publica una solicitud que el contexto Notifications
 * consume. El identificador de plantilla forma parte del contrato asincrono
 * entre ambos contextos.
 */
export interface NotificationRequest {
  readonly notificationId: string
  readonly recipient: string
  readonly templateId: string
  readonly variables: Readonly<Record<string, string | number | boolean>>
}

export interface NotificationRequestPort {
  request(notification: NotificationRequest): Promise<void>
}

export const NOTIFICATION_REQUEST = Symbol('NotificationRequestPort')
