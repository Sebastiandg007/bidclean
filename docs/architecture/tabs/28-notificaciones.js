/**
 * 28-notificaciones.js — notificaciones push con outbox transaccional durable y OneSignal como transporte.
 */
BidCleanArch.registerTab({
  id: 'notificaciones',
  group: 'Comunicación',
  order: 280,
  title: 'Notificaciones push',
  summary:
    'Un único camino para avisar a Host y Cleaner cuando la app está en segundo plano. '
    + 'El módulo <b>reacciona</b> a hechos ya confirmados mediante un <b>outbox transaccional</b>: nunca es fuente de verdad y ninguna transacción de negocio depende de que un push tenga éxito. '
    + 'La intención de entrega es exactamente-una-vez en PostgreSQL (ganador único PENDING → PROCESSING, dedup_key UNIQUE); el envío a OneSignal es al-menos-una-vez y se dirige por player id con consentimiento (Modelo B). '
    + '<b>Estado:</b> la tubería completa está implementada y probada, pero faltan las credenciales reales de OneSignal; además, el relay solo lee cinco outboxes (offer, payment, negotiation, chat, voip).',
  diagrams: [
    {
      title: 'Tubería de entrega: outbox → intención → OneSignal',
      description: 'Cada dominio escribe su fila outbox en la misma transacción que el hecho. El relay la convierte en una intención deduplicada y un worker BullMQ la entrega.',
      code: `flowchart TB
  subgraph SG_DOMINIOS["Dominios emisores · escriben en su transacción"]
    OB_OFERTA[("offer_outbox<br/>offer.matched")]
    OB_PAGO[("payment_outbox<br/>captured, released, refunded")]
    OB_NEGOCIA[("negotiation_outbox<br/>propuestas")]
    OB_CHAT[("chat_outbox<br/>message-created")]
    OB_VOIP[("voip_outbox<br/>call-invited")]
  end
  RELE["OutboxRelayProcessor<br/>drena en lotes, por fila aislada"]
  MAPPERS["Mappers por dominio<br/>fila a NotificationIntent, solo ids"]
  SERVICIO_NOTIF["NotificationService.createIntent<br/>durable primero, supresión atómica"]
  PREFS["PreferenceService.decide<br/>categorías y horas silenciosas"]
  LEDGER[("notifications<br/>ledger con dedup_key UNIQUE")]
  COLA["Cola notifications-delivery<br/>BullMQ"]
  TRABAJADOR["DeliveryWorker<br/>PENDING a PROCESSING, un ganador"]
  CATALOGO["NotificationContentCatalog<br/>plantillas en y es"]
  ONESIGNAL["OneSignalClient<br/>REST, llave solo en servidor"]
  ONESIGNAL_EXT["OneSignal<br/>APNs y FCM"]
  DISPOSITIVO["Dispositivo del usuario"]
  WEBHOOK["OneSignalWebhookController<br/>POST /webhooks/onesignal"]
  EVENTOS_WH[("onesignal_webhook_events<br/>deduplicación")]
  OB_SERVICIO[("service_outbox, verification, checklist,<br/>completion y dispute outbox")]

  OB_OFERTA --> RELE
  OB_PAGO --> RELE
  OB_NEGOCIA --> RELE
  OB_CHAT --> RELE
  OB_VOIP --> RELE
  RELE --> MAPPERS
  MAPPERS --> SERVICIO_NOTIF
  SERVICIO_NOTIF --> PREFS
  SERVICIO_NOTIF -->|intención única| LEDGER
  LEDGER -->|encola| COLA
  COLA --> TRABAJADOR
  TRABAJADOR --> CATALOGO
  TRABAJADOR -->|un envío por player id consentido| ONESIGNAL
  ONESIGNAL -->|clave de idempotencia| ONESIGNAL_EXT
  ONESIGNAL_EXT --> DISPOSITIVO
  ONESIGNAL_EXT -->|callbacks firmados HMAC| WEBHOOK
  WEBHOOK --> EVENTOS_WH
  TRABAJADOR -->|SENT, FAILED o SUPPRESSED| LEDGER
  OB_SERVICIO -.->|sin mapper todavía| RELE`,
    },
    {
      title: 'Registro de dispositivos, preferencias y enrutamiento en la app',
      description: 'La app pide permiso, registra el player id (Modelo B) y, al tocar un push, navega por deep-link y reconcilia con GET.',
      code: `flowchart TB
  ARRANQUE["useNotificationBootstrap<br/>permiso, SDK, player id"]
  SDK["onesignal.sdk<br/>seam sobre el SDK nativo"]
  ALMACEN_N["notifications.store<br/>permiso, preferencias, de-dup en primer plano"]
  AJUSTES["NotificationSettingsScreen<br/>categorías y horas silenciosas"]
  ENRUTA["useNotificationRouting<br/>deep-link, navegación y GET"]
  LLAMADA["Hoja de llamada entrante<br/>IncomingCallSheet"]
  CTRL_DISP["NotificationDeviceController<br/>/notifications/devices"]
  CTRL_PREF["NotificationPreferenceController<br/>/notifications/preferences"]
  REGISTRO["DeviceRegistryService<br/>registrar, consentir, desregistrar, sync de tags"]
  DB_DISP[("notification_devices<br/>notification_preferences")]
  RECONCILIA["ReconcileSweepProcessor<br/>repara deriva registro y OneSignal"]
  ONESIGNAL_SYNC["OneSignal<br/>external user id y tags"]

  ARRANQUE --> SDK
  ARRANQUE -->|POST devices| CTRL_DISP
  AJUSTES -->|GET y PUT| CTRL_PREF
  AJUSTES --> ALMACEN_N
  CTRL_DISP --> REGISTRO
  CTRL_PREF --> DB_DISP
  REGISTRO --> DB_DISP
  REGISTRO -->|sincroniza| ONESIGNAL_SYNC
  RECONCILIA --> DB_DISP
  RECONCILIA -->|re-empuja estado autoritativo| ONESIGNAL_SYNC
  SDK -->|push recibido o tocado| ENRUTA
  ENRUTA -->|incoming_call| LLAMADA
  ENRUTA --> ALMACEN_N`,
    },
  ],
  nodes: {
    OB_OFERTA: { title: 'offer_outbox', tipo: 'Tabla outbox', descripcion: 'Escrita por OfferNotificationService en una transacción. event_id = offer:<offerId>:<type>:<recipientUserId>.', ubicacion: 'services/api/src/notifications/entities/outbox.entity.ts', produce: ['offer.matched'], estado: 'hecho' },
    OB_PAGO: { title: 'payment_outbox', tipo: 'Tabla outbox', descripcion: 'Capturado, fallido, liberado, reembolsado y disputado; escrita desde las transacciones de estado del dinero en PaymentsRepository.', ubicacion: 'services/api/src/notifications/entities/outbox.entity.ts', produce: ['payment.released'], estado: 'hecho' },
    OB_NEGOCIA: { title: 'negotiation_outbox', tipo: 'Tabla outbox', descripcion: 'Propuesta creada, contraofertada, rechazada o aceptada.', ubicacion: 'services/api/src/notifications/entities/outbox.entity.ts', estado: 'hecho' },
    OB_CHAT: { title: 'chat_outbox', tipo: 'Tabla outbox', descripcion: 'message-created, para mensajes TEXT y VOICE.', ubicacion: 'services/api/src/chat/chat-outbox.ts', produce: ['message-created'], estado: 'hecho' },
    OB_VOIP: { title: 'voip_outbox', tipo: 'Tabla outbox', descripcion: 'call-invited, escrita al crear una llamada RINGING nueva.', ubicacion: 'services/api/src/chat/voip/voip-outbox.ts', produce: ['call-invited'], estado: 'hecho' },
    OB_SERVICIO: { title: 'Outboxes de ejecución del servicio', tipo: 'Tablas outbox', descripcion: 'service_outbox, verification_outbox, checklist_outbox, completion_outbox y dispute_outbox existen, pero NotificationsModule no tiene entidad ni mapper para ellas: sus eventos (service_arrived, service_confirmed, etc.) todavía no generan push por este camino.', ubicacion: 'services/api/src/notifications/mappers', estado: 'falta', nota: 'El relay solo cubre offer, payment, negotiation, chat y voip.' },
    RELE: { title: 'OutboxRelayProcessor', tipo: 'Worker programado', descripcion: 'Repetible (intervalo y lote por configuración). Por cada fila sin relevar, la más antigua primero: mapper, createIntent y markRelayed. Un fallo deja la fila para el siguiente ciclo sin tocar la transacción ya confirmada. Al-menos-una-vez e idempotente.', tecnologia: '@nestjs/schedule', ubicacion: 'services/api/src/notifications/outbox-relay.processor.ts', estado: 'hecho' },
    MAPPERS: { title: 'Mappers por dominio', tipo: 'Funciones puras', descripcion: 'chat, negotiation, offer, payment y voip. Convierten una fila outbox en un NotificationIntent con deep-links basados solo en ids, sin PII.', ubicacion: 'services/api/src/notifications/mappers', estado: 'hecho' },
    SERVICIO_NOTIF: { title: 'NotificationService.createIntent', tipo: 'Servicio NestJS', descripcion: 'Durable primero: decide la supresión y guarda la intención de forma atómica; exactamente-una-vez por dedup_key.', ubicacion: 'services/api/src/notifications/notification.service.ts', adr: 'ADR-013', estado: 'hecho' },
    PREFS: { title: 'PreferenceService.decide', tipo: 'Función pura', descripcion: 'Decisión de supresión guiada por metadatos del tipo: categorías, horas silenciosas, llamadas exentas y fail-open ante datos ausentes.', ubicacion: 'services/api/src/notifications/preference.service.ts', estado: 'hecho' },
    LEDGER: { title: 'notifications', tipo: 'Tabla PostgreSQL', descripcion: 'Libro de intenciones y resultados: PENDING, PROCESSING, SENT, SUPPRESSED, FAILED_RETRYABLE, FAILED_FINAL. dedup_key UNIQUE.', ubicacion: 'services/api/src/notifications/entities/notification.entity.ts', estado: 'hecho' },
    COLA: { title: 'Cola notifications-delivery', tipo: 'Cola BullMQ', descripcion: 'Trabajo deliver-notification con reintentos y backoff exponencial (NOTIFICATIONS_DELIVERY_MAX_ATTEMPTS y _BACKOFF_MS).', tecnologia: 'BullMQ + Redis', ubicacion: 'services/api/src/notifications/notifications.constants.ts', estado: 'hecho' },
    TRABAJADOR: { title: 'DeliveryWorker', tipo: 'Worker BullMQ', descripcion: 'Un solo ganador PENDING a PROCESSING; sin dispositivo consentido queda SUPPRESSED (no-device). Envía por player id con clave de idempotencia; un error de transporte reintenta y al agotar pasa a FAILED_FINAL. Un player id inválido se marca obsoleto.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/notifications/delivery.worker.ts', estado: 'parcial', nota: 'Sin credenciales de OneSignal solo se puede probar con mocks.' },
    CATALOGO: { title: 'NotificationContentCatalog', tipo: 'Servicio NestJS', descripcion: 'Plantillas por tipo en en y es, con verificación de paridad al arrancar: un tipo sin idioma falla rápido en lugar de enviar un push vacío.', ubicacion: 'services/api/src/notifications/notification-content.catalog.ts', estado: 'parcial', nota: 'Solo en y es; la plataforma declara siete idiomas.' },
    ONESIGNAL: { title: 'OneSignalClient', tipo: 'Cliente HTTP', descripcion: 'Transporte best-effort generalizado. La llave REST (ONESIGNAL_API_KEY) vive solo en el servidor.', tecnologia: 'OneSignal REST', ubicacion: 'services/api/src/notifications/onesignal/onesignal.client.ts', estado: 'parcial', nota: 'Faltan ONESIGNAL_APP_ID y ONESIGNAL_API_KEY reales.' },
    ONESIGNAL_EXT: { title: 'OneSignal', tipo: 'Servicio externo', descripcion: 'Entrega al sistema operativo mediante APNs (iOS) y FCM (Android) y devuelve callbacks.', tecnologia: 'OneSignal', estado: 'externo' },
    DISPOSITIVO: { title: 'Dispositivo del usuario', tipo: 'Actor', descripcion: 'Recibe el push; si la app está abierta prevalece el aviso en tiempo real y la de-duplicación en primer plano es fail-open.', estado: 'externo' },
    WEBHOOK: { title: 'OneSignalWebhookController', tipo: 'Webhook público', descripcion: 'POST /webhooks/onesignal. Verifica HMAC-SHA256 sobre el cuerpo crudo con ventana de tolerancia anti-repetición; idempotente.', ubicacion: 'services/api/src/notifications/webhooks/onesignal-webhook.controller.ts', estado: 'hecho' },
    EVENTOS_WH: { title: 'onesignal_webhook_events', tipo: 'Tabla PostgreSQL', descripcion: 'Eventos de webhook ya procesados, para deduplicar.', ubicacion: 'services/api/src/notifications/entities/onesignal-webhook-event.entity.ts', estado: 'hecho' },
    ARRANQUE: { title: 'useNotificationBootstrap', tipo: 'Hook móvil', descripcion: 'Tras autenticar: pide permiso, inicializa el SDK, obtiene el player id y registra el dispositivo. Si el permiso se deniega registra consent=false.', ubicacion: 'apps/mobile/src/screens/notifications/useNotificationBootstrap.ts', estado: 'hecho' },
    SDK: { title: 'onesignal.sdk', tipo: 'Seam móvil', descripcion: 'Capa fina sobre el SDK de OneSignal, con implementación no-op por defecto para poder probar sin módulo nativo.', tecnologia: 'react-native-onesignal (pendiente de integrar)', ubicacion: 'apps/mobile/src/screens/notifications/onesignal.sdk.ts', estado: 'parcial', nota: 'Falta enlazar react-native-onesignal en el shell de la app.' },
    ALMACEN_N: { title: 'notifications.store', tipo: 'Store Zustand', descripcion: 'Estado del dispositivo y del permiso, preferencias y contabilidad de de-duplicación en primer plano.', tecnologia: 'Zustand', ubicacion: 'apps/mobile/src/screens/notifications/notifications.store.ts', estado: 'hecho' },
    AJUSTES: { title: 'NotificationSettingsScreen', tipo: 'Pantalla móvil', descripcion: 'Activar o desactivar categorías y configurar horas silenciosas, con los tokens del sistema de diseño.', ubicacion: 'apps/mobile/src/screens/notifications/NotificationSettingsScreen.tsx', estado: 'hecho' },
    ENRUTA: { title: 'useNotificationRouting', tipo: 'Hook móvil', descripcion: 'Interpreta el deep-link (solo ids), navega y reconcilia el estado autoritativo por GET. El tipo incoming_call abre la hoja de llamada.', ubicacion: 'apps/mobile/src/screens/notifications/useNotificationRouting.ts', estado: 'hecho' },
    LLAMADA: { title: 'IncomingCallSheet', tipo: 'Componente móvil', descripcion: 'Hoja de llamada entrante del módulo VoIP, abierta mediante openIncomingCall.', ubicacion: 'apps/mobile/src/screens/chat/voip/components/IncomingCallSheet.tsx', estado: 'hecho' },
    CTRL_DISP: { title: 'NotificationDeviceController', tipo: 'Controlador NestJS', descripcion: 'Registrar, consentir y desregistrar dispositivos, siempre acotado al sujeto del JWT.', ubicacion: 'services/api/src/notifications/notification-device.controller.ts', estado: 'hecho' },
    CTRL_PREF: { title: 'NotificationPreferenceController', tipo: 'Controlador NestJS', descripcion: 'Leer y actualizar categorías y horas silenciosas del propio usuario.', ubicacion: 'services/api/src/notifications/notification-preference.controller.ts', estado: 'hecho' },
    REGISTRO: { title: 'DeviceRegistryService', tipo: 'Servicio NestJS', descripcion: 'Autoridad del registro (Modelo B): registrar, consentir, desregistrar, marcar obsoletos y sincronizar tags con OneSignal.', ubicacion: 'services/api/src/notifications/device-registry.service.ts', estado: 'hecho' },
    DB_DISP: { title: 'notification_devices / notification_preferences', tipo: 'Tablas PostgreSQL', descripcion: 'Dispositivos con su consentimiento y las preferencias por usuario.', ubicacion: 'services/api/src/notifications/entities', estado: 'hecho' },
    RECONCILIA: { title: 'ReconcileSweepProcessor', tipo: 'Worker programado', descripcion: 'Barrido acotado que re-empuja a OneSignal el estado autoritativo (external user id y tags) de un lote de dispositivos consentidos y no obsoletos.', ubicacion: 'services/api/src/notifications/reconcile-sweep.processor.ts', estado: 'hecho' },
    ONESIGNAL_SYNC: { title: 'OneSignal (registro)', tipo: 'Servicio externo', descripcion: 'Mantiene la asociación de usuario externo y los tags de segmentación.', tecnologia: 'OneSignal', estado: 'externo' },
  },
  sections: [
    {
      title: 'Endpoints',
      html: `<table>
<thead><tr><th>Método</th><th>Ruta</th><th>Descripción</th></tr></thead>
<tbody>
<tr><td>POST</td><td><code>/notifications/devices</code></td><td>Registra o actualiza el dispositivo del usuario (Modelo B).</td></tr>
<tr><td>PATCH</td><td><code>/notifications/devices/:playerId/consent</code></td><td>Actualiza el consentimiento del dispositivo.</td></tr>
<tr><td>DELETE</td><td><code>/notifications/devices/:playerId</code></td><td>Desregistra el dispositivo (cierre de sesión).</td></tr>
<tr><td>GET</td><td><code>/notifications/preferences</code></td><td>Lee las preferencias del usuario.</td></tr>
<tr><td>PUT</td><td><code>/notifications/preferences</code></td><td>Actualiza categorías y horas silenciosas.</td></tr>
<tr><td>POST</td><td><code>/webhooks/onesignal</code></td><td>Callbacks firmados e idempotentes de OneSignal (público).</td></tr>
</tbody></table>`,
    },
    {
      title: 'Variables de configuración',
      html: `<p><code>ONESIGNAL_APP_ID</code>, <code>ONESIGNAL_API_KEY</code>, <code>ONESIGNAL_WEBHOOK_SECRET</code> (obligatorias), <code>ONESIGNAL_API_URL</code>, <code>ONESIGNAL_TIMEOUT_MS</code>, <code>ONESIGNAL_WEBHOOK_TOLERANCE_SECONDS</code>, <code>NOTIFICATIONS_DELIVERY_MAX_ATTEMPTS</code>, <code>NOTIFICATIONS_DELIVERY_BACKOFF_MS</code>, <code>NOTIFICATIONS_RELAY_INTERVAL_MS</code>, <code>NOTIFICATIONS_RELAY_BATCH_SIZE</code>, <code>NOTIFICATIONS_RECONCILE_INTERVAL_MS</code>, <code>NOTIFICATIONS_RECONCILE_BATCH_SIZE</code>, <code>NOTIFICATIONS_RETENTION_DAYS</code>. En la app: <code>EXPO_PUBLIC_ONESIGNAL_APP_ID</code>.</p>`,
    },
  ],
});
