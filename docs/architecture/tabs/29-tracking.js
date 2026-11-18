/**
 * 29-tracking.js — seguimiento del servicio: sesión de ejecución, GPS efímero por Centrifugo y geocerca autoritativa en el servidor.
 */
BidCleanArch.registerTab({
  id: 'tracking',
  group: 'Ejecución del servicio',
  order: 290,
  title: 'Seguimiento (GPS y geocerca)',
  summary:
    'Fase posterior al emparejamiento y previa al trabajo: el Cleaner va hacia la propiedad, el Host ve su posición en vivo y una <b>geocerca autoritativa en el servidor</b> confirma la llegada. '
    + 'La sesión <code>service_sessions</code> es 1 a 1 con la oferta emparejada y cobrada. La posición es <b>efímera</b>: se evalúa y se retransmite, nunca se guarda; el único dato durable es <code>arrival_distance_m</code>. '
    + 'Mapbox solo dibuja; la verdad es la máquina de estados en PostgreSQL, reconciliada con GET. '
    + 'Estado: backend y app implementados; los eventos viajan por service_outbox con un consumidor independiente por destino (video, checklist y el nombre reservado notifications).',
  diagrams: [
    {
      title: 'Activación de la sesión y flujo de posición en vivo',
      description: 'El Cleaner envía muestras por REST (Opción A: el servidor está en la ruta); el servidor evalúa la geocerca y retransmite al canal service:session:{id}, al que el Host solo se suscribe.',
      code: `flowchart TB
  COBRO_ESCROW["EscrowChargeService<br/>cobro retenido HELD"]
  OB_ACTIVA[("service_activation_outbox<br/>service_activation_ready")]
  ACTIVA["ServiceActivationConsumer<br/>checkpoint service_activation_consumed"]
  SESION[("service_sessions<br/>MATCHED, EN_ROUTE, ARRIVED, IN_PROGRESS")]
  subgraph SG_CLEANER["App del Cleaner"]
    EN_RUTA_PANT["EnRouteScreen<br/>Voy en camino y Iniciar"]
    REPORTA["usePositionReporter<br/>permiso, envío limitado, nunca publica"]
  end
  subgraph SG_API["API · ServiceTrackingModule"]
    CTRL_SES["ServiceSessionController<br/>/service-sessions"]
    SVC_SES["ServiceSessionService<br/>estados y entrada de posición"]
    LIMITA["PositionRateLimiter<br/>SET NX PX en Redis, fail-open"]
    GEO["GeofenceService<br/>isEligible y PostGIS isWithinGeofence"]
    PARTICIPA_S["ServiceSessionParticipationService<br/>regla de participante"]
  end
  CENTRI_S["Centrifugo<br/>canal service:session:id"]
  AUTH_S["Auth: token de suscripción<br/>del canal de sesión"]
  subgraph SG_HOST["App del Host"]
    CANAL_H["useTrackingChannel<br/>suscripción de solo lectura"]
    ALMACEN_T["tracking.store<br/>sin regresión de estado"]
    MAPA_PANT["TrackingScreen<br/>posición y destino"]
  end
  MAPBOX["Mapbox<br/>solo dibuja"]
  OB_SERVICIO[("service_outbox<br/>service_en_route, service_arrived, service_started")]
  CONSUMIDORES["Consumidores por checkpoint<br/>video, checklist, notifications"]

  COBRO_ESCROW -->|misma transacción| OB_ACTIVA
  OB_ACTIVA --> ACTIVA
  ACTIVA -->|crea sesión idempotente| SESION
  EN_RUTA_PANT -->|POST en-route| CTRL_SES
  REPORTA -->|POST position| CTRL_SES
  EN_RUTA_PANT -->|POST start| CTRL_SES
  CTRL_SES --> SVC_SES
  SVC_SES --> LIMITA
  SVC_SES --> GEO
  SVC_SES --> PARTICIPA_S
  SVC_SES -->|transición única + outbox en 1 tx| SESION
  SVC_SES -->|transición única + outbox en 1 tx| OB_SERVICIO
  SVC_SES -->|re-publica posición y estado| CENTRI_S
  CENTRI_S --> CANAL_H
  CANAL_H -->|token| AUTH_S
  AUTH_S --> PARTICIPA_S
  CANAL_H --> ALMACEN_T
  ALMACEN_T --> MAPA_PANT
  MAPA_PANT --> MAPBOX
  ALMACEN_T -->|GET reconciliación| CTRL_SES
  OB_SERVICIO --> CONSUMIDORES`,
    },
    {
      title: 'Estados de la sesión y mantenimiento',
      description: 'Las transiciones terminales son de un solo ganador. El barrido cierra sesiones abandonadas o sin progreso, y un listener cancela si la oferta termina.',
      code: `flowchart LR
  MATCHED["MATCHED<br/>sesión creada tras el cobro"]
  EN_ROUTE["EN_ROUTE<br/>Cleaner en camino"]
  GEOCERCA{"¿Dentro de la geocerca<br/>y muestra elegible?"}
  ARRIVED["ARRIVED<br/>evento service_arrived"]
  IN_PROGRESS["IN_PROGRESS<br/>evento service_started"]
  CANCELED(["CANCELED<br/>por participante u oferta terminal"])
  EXPIRED(["EXPIRED<br/>sin inicio, sin progreso o propiedad eliminada"])
  BARRIDO_S["ServiceSweepProcessor<br/>BullMQ service-tracking-sweep"]
  ESCUCHA_S["OfferTerminalSessionListener<br/>cancela de forma idempotente"]

  MATCHED -->|en-route, evento service_en_route| EN_ROUTE
  EN_ROUTE -->|position| GEOCERCA
  GEOCERCA -->|no| EN_ROUTE
  GEOCERCA -->|sí, arrival_distance_m guardada| ARRIVED
  ARRIVED -->|start del Cleaner| IN_PROGRESS
  MATCHED -->|cancel| CANCELED
  EN_ROUTE -->|cancel| CANCELED
  BARRIDO_S -->|EXPIRED_NEVER_STARTED| EXPIRED
  BARRIDO_S -->|EXPIRED_NO_PROGRESS| EXPIRED
  ESCUCHA_S -->|CANCELED_OFFER_TERMINAL| CANCELED`,
    },
  ],
  nodes: {
    COBRO_ESCROW: { title: 'EscrowChargeService', tipo: 'Servicio NestJS', descripcion: 'Al pasar el cobro a HELD escribe service_activation_ready en service_activation_outbox dentro de la misma transacción (markChargeSucceeded con extraOutbox).', ubicacion: 'services/api/src/payments/escrow/escrow-charge.service.ts', produce: ['service_activation_ready'], adr: 'ADR-005', estado: 'parcial', nota: 'Requiere llaves reales de Stripe.' },
    OB_ACTIVA: { title: 'service_activation_outbox', tipo: 'Tabla outbox', descripcion: 'Tabla dedicada (no payment_outbox) porque el relay de notificaciones marca como relevadas las filas de tipo desconocido y perdería el hecho. event_id = service_activation_ready:<offerId>; payload { offerId, hostId, cleanerId, propertyId }.', ubicacion: 'services/api/src/service-tracking/service-activation-outbox.ts', produce: ['service_activation_ready'], estado: 'hecho' },
    ACTIVA: { title: 'ServiceActivationConsumer', tipo: 'Consumidor de eventos', descripcion: 'Drena service_activation_ready con su propio checkpoint service_activation_consumed (nunca toca un relayed_at compartido) y crea la sesión de forma idempotente. Intervalo y lote configurables (SERVICE_ACTIVATION_DRAIN_*).', tecnologia: '@nestjs/schedule', ubicacion: 'services/api/src/service-tracking/service-activation.consumer.ts', consume: ['service_activation_ready'], estado: 'hecho' },
    SESION: { title: 'service_sessions', tipo: 'Tabla PostgreSQL', descripcion: 'Ciclo de vida durable 1 a 1 con la oferta emparejada y cobrada. Guarda el snapshot de la geocerca (radio y centro) y arrival_distance_m como único dato de ubicación durable.', tecnologia: 'PostgreSQL + PostGIS', ubicacion: 'services/api/src/service-tracking/entities/service-session.entity.ts', adr: 'ADR-015', estado: 'hecho' },
    EN_RUTA_PANT: { title: 'EnRouteScreen', tipo: 'Pantalla móvil', descripcion: 'Interfaz del Cleaner: destino, botón de salir hacia la propiedad y botón Iniciar habilitado solo en ARRIVED, con explicación de permisos.', ubicacion: 'apps/mobile/src/screens/tracking/EnRouteScreen.tsx', estado: 'hecho' },
    REPORTA: { title: 'usePositionReporter', tipo: 'Hook móvil', descripcion: 'Pide permiso de ubicación y envía muestras con límite de cadencia mientras la sesión está EN_ROUTE. Si se deniega el permiso no falla. Nunca publica en el canal.', tecnologia: 'expo-location', ubicacion: 'apps/mobile/src/screens/tracking/usePositionReporter.ts', estado: 'hecho' },
    CTRL_SES: { title: 'ServiceSessionController', tipo: 'Controlador NestJS', descripcion: 'Superficie REST /service-sessions con JWT y acceso solo para participantes.', ubicacion: 'services/api/src/service-tracking/service-session.controller.ts', estado: 'hecho' },
    SVC_SES: { title: 'ServiceSessionService', tipo: 'Servicio NestJS', descripcion: 'Máquina de estados y entrada de posición (Opción A). Cada transición va con su fila de service_outbox en una sola transacción; luego re-publica a Centrifugo en modo best-effort.', ubicacion: 'services/api/src/service-tracking/service-session.service.ts', produce: ['service_en_route', 'service_arrived', 'service_started'], adr: 'ADR-015', estado: 'hecho' },
    LIMITA: { title: 'PositionRateLimiter', tipo: 'Utilidad Redis', descripcion: 'Limitador del lado servidor por (usuario, sesión) con SET NX PX. Si Redis falla, deja pasar (fail-open).', tecnologia: 'Redis', ubicacion: 'services/api/src/service-tracking/position-rate-limiter.ts', estado: 'hecho' },
    GEO: { title: 'GeofenceService', tipo: 'Servicio NestJS', descripcion: 'isEligible (precisión, antigüedad y desfase de reloj de la muestra) y isWithinGeofence con PostGIS sobre el snapshot. Radio por defecto 50 m (SERVICE_GEOFENCE_RADIUS_M).', tecnologia: 'PostGIS', ubicacion: 'services/api/src/service-tracking/geofence.service.ts', estado: 'hecho' },
    PARTICIPA_S: { title: 'ServiceSessionParticipationService', tipo: 'Servicio NestJS', descripcion: 'Única regla de participación, compartida con el endpoint de tokens de auth (auth emite, tracking decide).', ubicacion: 'services/api/src/service-tracking/service-session-participation.service.ts', estado: 'hecho' },
    CENTRI_S: { title: 'Centrifugo · service:session:{id}', tipo: 'Canal de tiempo real', descripcion: 'Transporte de salida servidor → Host. El Cleaner nunca publica. Un frame perdido no corrompe el estado: se reconcilia con GET.', tecnologia: 'Centrifugo', ubicacion: 'services/api/src/service-tracking/service-tracking.constants.ts', estado: 'hecho' },
    AUTH_S: { title: 'GET /auth/centrifugo/token', tipo: 'Endpoint de auth', descripcion: 'Firma el token de suscripción de service:session:{id} con expiración acotada, previa consulta de participación.', ubicacion: 'services/api/src/auth', estado: 'hecho' },
    CANAL_H: { title: 'useTrackingChannel', tipo: 'Hook de tiempo real', descripcion: 'Suscripción de solo lectura: token, reconexión con backoff, reconciliación al volver a primer plano y parseo de señales de posición y estado.', ubicacion: 'apps/mobile/src/screens/tracking/useTrackingChannel.ts', estado: 'hecho' },
    ALMACEN_T: { title: 'tracking.store', tipo: 'Store Zustand', descripcion: 'Sesión, última posición en vivo y estado de conexión. Aplica señales de estado de forma idempotente y sin regresión; reconcilia por GET.', tecnologia: 'Zustand', ubicacion: 'apps/mobile/src/screens/tracking/tracking.store.ts', estado: 'hecho' },
    MAPA_PANT: { title: 'TrackingScreen', tipo: 'Pantalla móvil', descripcion: 'Interfaz del Host: mapa con la posición del Cleaner y el destino, etiqueta de estado, aviso de llegada y mensaje de ubicación no disponible.', ubicacion: 'apps/mobile/src/screens/tracking/TrackingScreen.tsx', estado: 'hecho' },
    MAPBOX: { title: 'Mapbox', tipo: 'Servicio externo', descripcion: 'Renderiza posición y destino con @rnmapbox/maps. Nunca es fuente de verdad.', tecnologia: '@rnmapbox/maps', ubicacion: 'apps/mobile/src/screens/tracking/TrackingScreen.tsx', adr: 'ADR-004', estado: 'parcial', nota: 'Requiere token de Mapbox real para ver el mapa.' },
    OB_SERVICIO: { title: 'service_outbox', tipo: 'Tabla outbox', descripcion: 'Eventos service_en_route, service_arrived (con arrivalDistanceM) y service_started (con snapshot opcional de checklist y políticas). Ids determinísticos service_<evento>:<sessionId>.', ubicacion: 'services/api/src/service-tracking/service-outbox.ts', produce: ['service_en_route', 'service_arrived', 'service_started'], estado: 'hecho' },
    CONSUMIDORES: { title: 'Consumidores independientes', tipo: 'Fan-out por checkpoint', descripcion: 'service_outbox_consumers con clave (event_id, consumer_name). VIDEO y CHECKLIST están conectados (verification-arrival.consumer y checklist-started.consumer). El nombre NOTIFICATIONS está declarado, pero no hay mapper de service_outbox en NotificationsModule.', ubicacion: 'services/api/src/service-tracking/service-outbox-consumer.checkpoint.ts', consume: ['service_arrived', 'service_started'], estado: 'parcial', nota: 'Los avisos push de llegada e inicio aún no tienen mapper.' },
    MATCHED: { title: 'MATCHED', tipo: 'Estado', descripcion: 'Sesión creada por el consumidor de activación; esperando que el Cleaner salga.', estado: 'hecho' },
    EN_ROUTE: { title: 'EN_ROUTE', tipo: 'Estado', descripcion: 'El Cleaner marcó que va en camino. Habilita el envío de posición. Emite service_en_route.', produce: ['service_en_route'], estado: 'hecho' },
    GEOCERCA: { title: '¿Dentro de la geocerca?', tipo: 'Decisión', descripcion: 'El servidor decide, no el cliente: la muestra debe ser elegible (precisión, antigüedad, reloj) y estar dentro del radio.', ubicacion: 'services/api/src/service-tracking/geofence.service.ts', estado: 'hecho' },
    ARRIVED: { title: 'ARRIVED', tipo: 'Estado', descripcion: 'Llegada confirmada por el servidor. Emite service_arrived, que desbloquea la verificación por video.', produce: ['service_arrived'], estado: 'hecho' },
    IN_PROGRESS: { title: 'IN_PROGRESS', tipo: 'Estado', descripcion: 'El Cleaner empieza el trabajo. Emite service_started con el snapshot del checklist.', produce: ['service_started'], estado: 'hecho' },
    CANCELED: { title: 'CANCELED', tipo: 'Estado terminal', descripcion: 'CANCELED_BY_PARTICIPANT o CANCELED_OFFER_TERMINAL.', estado: 'hecho' },
    EXPIRED: { title: 'EXPIRED', tipo: 'Estado terminal', descripcion: 'EXPIRED_NEVER_STARTED, EXPIRED_NO_PROGRESS o EXPIRED_PROPERTY_REMOVED.', estado: 'hecho' },
    BARRIDO_S: { title: 'ServiceSweepProcessor', tipo: 'Worker BullMQ', descripcion: 'Barrido acotado e idempotente: abandona sesiones nunca iniciadas (SERVICE_SESSION_ABANDON_MS, 1 h) y las sin progreso en camino (SERVICE_EN_ROUTE_STALE_MS, 30 min).', tecnologia: 'BullMQ (service-tracking-sweep)', ubicacion: 'services/api/src/service-tracking/service-sweep.processor.ts', estado: 'hecho' },
    ESCUCHA_S: { title: 'OfferTerminalSessionListener', tipo: 'Listener de eventos', descripcion: 'Al pasar la oferta a CANCELLED, EXPIRED o COMPLETED cancela la sesión de forma idempotente.', ubicacion: 'services/api/src/service-tracking/offer-terminal-session.listener.ts', consume: ['offer CANCELLED', 'offer EXPIRED', 'offer COMPLETED'], estado: 'hecho' },
  },
  sections: [
    {
      title: 'Endpoints de service-sessions',
      html: `<table>
<thead><tr><th>Método</th><th>Ruta</th><th>Descripción</th></tr></thead>
<tbody>
<tr><td>GET</td><td><code>/service-sessions/:id</code></td><td>Estado autoritativo para reconciliar (solo participantes).</td></tr>
<tr><td>POST</td><td><code>/service-sessions/:id/en-route</code></td><td>El Cleaner sale: MATCHED → EN_ROUTE.</td></tr>
<tr><td>POST</td><td><code>/service-sessions/:id/position</code></td><td>Muestra { lat, lng, accuracy, heading?, at }: limitada, evaluada contra la geocerca y re-publicada.</td></tr>
<tr><td>POST</td><td><code>/service-sessions/:id/start</code></td><td>El Cleaner empieza el trabajo: ARRIVED → IN_PROGRESS.</td></tr>
<tr><td>POST</td><td><code>/service-sessions/:id/cancel</code></td><td>Cancelación explícita de un participante.</td></tr>
</tbody></table>`,
    },
    {
      title: 'Configuración',
      html: `<p>Bloque <code>SERVICE_*</code> de <code>.env.example</code>, validado al arrancar por <code>validateServiceTrackingConfig()</code>: <code>SERVICE_GEOFENCE_RADIUS_M</code> (50), <code>SERVICE_POSITION_MIN_INTERVAL_MS</code> (3000), <code>SERVICE_POSITION_MAX_ACCURACY_M</code> (50), <code>SERVICE_POSITION_MAX_AGE_MS</code> (30000), <code>SERVICE_EN_ROUTE_STALE_MS</code>, <code>SERVICE_SESSION_ABANDON_MS</code>, <code>SERVICE_SWEEP_INTERVAL_MS</code>, <code>SERVICE_SWEEP_BATCH_SIZE</code>. Se reutilizan las variables <code>CENTRIFUGO_*</code>.</p>`,
    },
  ],
});
