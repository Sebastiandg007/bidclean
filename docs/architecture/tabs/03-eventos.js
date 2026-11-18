/**
 * 03-eventos.js — tablas outbox, eventos de dominio, productores/consumidores y colas BullMQ.
 */
BidCleanArch.registerTab({
  id: 'eventos',
  group: 'Visión general',
  order: 30,
  title: 'Eventos y colas',
  summary:
    'Cada contexto escribe sus eventos de dominio en una tabla outbox dentro de la misma transacción del cambio de datos. '
    + 'Listeners y consumers reaccionan y generan el siguiente evento. El segundo diagrama muestra las colas BullMQ por módulo, todas sobre Redis.',
  diagrams: [
    {
      title: 'Cadena de eventos: del match al pago liberado',
      description: 'Cada caja gris con nombre de tabla es un outbox; los eventos van entre comillas de dominio. Flujo principal del servicio.',
      code: `flowchart TB
  WRITER["OutboxWriter<br/>packages/shared"]
  OFFER_OB[("offer_outbox")]
  EV_MATCHED["offer.matched"]
  L_MATCHED["OfferMatchedListener"]
  ESCROW_CHARGE["EscrowChargeService"]
  SA_OB[("service_activation_outbox")]
  EV_SAREADY["service_activation_ready"]
  C_SA["ServiceActivationConsumer"]
  SVC_OB[("service_outbox")]
  EV_ENROUTE["service_en_route"]
  EV_ARRIVED["service_arrived"]
  EV_STARTED["service_started"]
  C_NOTIF["Consumidor de notificaciones"]
  C_VARR["VerificationArrivalConsumer"]
  C_CHKSTART["ChecklistStartedConsumer"]
  VER_OB[("verification_outbox")]
  EV_VERDONE["verification_completed"]
  EV_VERFLAG["verification_flagged"]
  CHK_OB[("checklist_outbox")]
  EV_CHKDONE["checklist_completed"]
  C_COMP["CompletionCreatedConsumer"]
  COMP_OB[("completion_outbox")]
  EV_CONF["service_confirmed"]
  EV_DISP["service_disputed"]
  EV_RATED["service_rated"]
  W_RELEASE["ReleaseIntentWorker"]
  ESCROW_REL["EscrowReleaseService"]
  PAY_OB[("payment_outbox")]
  EV_PAYREL["payment.released"]
  C_DISP["DisputeCreatedConsumer"]
  WRITER -.-> OFFER_OB
  OFFER_OB --> EV_MATCHED --> L_MATCHED --> ESCROW_CHARGE
  ESCROW_CHARGE --> SA_OB --> EV_SAREADY --> C_SA
  C_SA --> SVC_OB
  SVC_OB --> EV_ENROUTE
  SVC_OB --> EV_ARRIVED
  SVC_OB --> EV_STARTED
  EV_ENROUTE --> C_NOTIF
  EV_ARRIVED --> C_NOTIF
  EV_ARRIVED --> C_VARR
  EV_STARTED --> C_CHKSTART
  C_VARR --> VER_OB
  VER_OB --> EV_VERDONE
  VER_OB --> EV_VERFLAG
  EV_VERDONE --> C_CHKSTART
  EV_VERFLAG --> C_NOTIF
  C_CHKSTART --> CHK_OB --> EV_CHKDONE --> C_COMP
  C_COMP --> COMP_OB
  COMP_OB --> EV_CONF
  COMP_OB --> EV_DISP
  COMP_OB --> EV_RATED
  EV_CONF --> W_RELEASE --> ESCROW_REL --> PAY_OB --> EV_PAYREL
  EV_DISP --> C_DISP`,
    },
    {
      title: 'Colas BullMQ por módulo',
      description: 'Las 16 colas de la API agrupadas por módulo. Todas persisten en Redis.',
      code: `flowchart LR
  REDIS[("Redis 7")]
  subgraph G_OFFERS["Módulo offers"]
    Q_RADIUS["offer-radius-expansion"]
    Q_TIER["offer-tier-delivery"]
    Q_FAVWIN["offer-favorites-window"]
    Q_OFFPUSH["offer-push-notification"]
  end
  subgraph G_PAYMENTS["Módulo payments"]
    Q_STRIPEWH["payments-stripe-webhook"]
    Q_DEFREL["payments-deferred-release"]
  end
  subgraph G_SUBS["Módulo subscriptions"]
    Q_RCWH["subscriptions-revenuecat-webhook"]
  end
  subgraph G_NOTIF["Módulo notifications"]
    Q_DELIVERY["notifications-delivery"]
  end
  subgraph G_VOICE["Módulo voice-notes"]
    Q_TRANSCRIBE["voice-notes-transcription"]
    Q_VOICECLEAN["voice-notes-cleanup"]
  end
  subgraph G_VOIP["Módulo voip-calls"]
    Q_VOIPSWEEP["voip-calls-sweep"]
  end
  subgraph G_TRACK["Módulo service-tracking"]
    Q_TRACKSWEEP["service-tracking-sweep"]
  end
  subgraph G_VIDEO["Módulo video-verification"]
    Q_FACE["video-face-comparison"]
  end
  subgraph G_CHECK["Módulo checklist-photos"]
    Q_PHOTOCLEAN["checklist-photos-cleanup"]
  end
  subgraph G_COMP["Módulo service-completion"]
    Q_COMPLETION["service-completion"]
  end
  subgraph G_DISP["Módulo dispute-system"]
    Q_DISPUTE["dispute-system"]
  end
  Q_RADIUS --> REDIS
  Q_TIER --> REDIS
  Q_FAVWIN --> REDIS
  Q_OFFPUSH --> REDIS
  Q_STRIPEWH --> REDIS
  Q_DEFREL --> REDIS
  Q_RCWH --> REDIS
  Q_DELIVERY --> REDIS
  Q_TRANSCRIBE --> REDIS
  Q_VOICECLEAN --> REDIS
  Q_VOIPSWEEP --> REDIS
  Q_TRACKSWEEP --> REDIS
  Q_FACE --> REDIS
  Q_PHOTOCLEAN --> REDIS
  Q_COMPLETION --> REDIS
  Q_DISPUTE --> REDIS`,
    },
  ],
  nodes: {
    WRITER: { title: 'OutboxWriter', tipo: 'Utilidad compartida', descripcion: 'Inserta el evento en la tabla outbox del contexto dentro de la misma transacción que el cambio de datos.', tecnologia: 'TypeScript + TypeORM', ubicacion: 'packages/shared/src/outbox/outbox-writer.ts', produce: ['Filas en tablas outbox'], estado: 'hecho' },
    OFFER_OB: { title: 'offer_outbox', tipo: 'Tabla outbox', descripcion: 'Eventos del contexto de ofertas: offer.matched, offer.cancelled, offer.expired, offer.completed.', tecnologia: 'PostgreSQL', ubicacion: 'services/api/src/offers/notification/offer-outbox.ts', produce: ['offer.matched', 'offer.cancelled', 'offer.expired', 'offer.completed'], estado: 'hecho' },
    EV_MATCHED: { title: 'offer.matched', tipo: 'Evento de dominio', descripcion: 'Una oferta fue aceptada por un Cleaner. Dispara el cobro en escrow.', ubicacion: 'offer_outbox', consume: ['OfferMatchedListener'], estado: 'hecho' },
    L_MATCHED: { title: 'OfferMatchedListener', tipo: 'Listener', descripcion: 'Reacciona a offer.matched e inicia el cobro del escrow.', tecnologia: 'NestJS', ubicacion: 'services/api/src/payments/listeners/offer-matched.listener.ts', consume: ['offer.matched'], produce: ['Llamada a EscrowChargeService'], estado: 'hecho' },
    ESCROW_CHARGE: { title: 'EscrowChargeService', tipo: 'Servicio', descripcion: 'Cobra al Host en Stripe y, al quedar el escrow retenido, escribe service_activation_ready.', tecnologia: 'NestJS + Stripe', ubicacion: 'services/api/src/payments', produce: ['service_activation_ready'], adr: 'ADR-005', estado: 'parcial', nota: 'Faltan credenciales reales de Stripe.' },
    SA_OB: { title: 'service_activation_outbox', tipo: 'Tabla outbox', descripcion: 'Tabla dedicada, separada de payment_outbox, para que el relay de notificaciones no marque el evento como entregado antes de tiempo.', tecnologia: 'PostgreSQL', ubicacion: 'services/api/src/service-tracking/service-activation-outbox.ts', produce: ['service_activation_ready'], estado: 'hecho' },
    EV_SAREADY: { title: 'service_activation_ready', tipo: 'Evento de dominio', descripcion: 'El escrow quedó retenido; la sesión de servicio puede crearse.', ubicacion: 'service_activation_outbox', consume: ['ServiceActivationConsumer'], estado: 'hecho' },
    C_SA: { title: 'ServiceActivationConsumer', tipo: 'Consumer', descripcion: 'Crea la sesión de servicio al recibir service_activation_ready.', tecnologia: 'NestJS', ubicacion: 'services/api/src/service-tracking/service-activation.consumer.ts', consume: ['service_activation_ready'], produce: ['Sesión de servicio'], estado: 'hecho' },
    SVC_OB: { title: 'service_outbox', tipo: 'Tabla outbox', descripcion: 'Fuente de fan-out: no tiene un relayed_at compartido; cada consumidor (notifications, video, checklist) lleva su propio avance.', tecnologia: 'PostgreSQL', ubicacion: 'services/api/src/service-tracking/service-outbox.ts', produce: ['service_en_route', 'service_arrived', 'service_started'], estado: 'hecho' },
    EV_ENROUTE: { title: 'service_en_route', tipo: 'Evento de dominio', descripcion: 'El Cleaner salió hacia la propiedad.', ubicacion: 'service_outbox', consume: ['Notificaciones'], estado: 'hecho' },
    EV_ARRIVED: { title: 'service_arrived', tipo: 'Evento de dominio', descripcion: 'El Cleaner llegó. Inicia la verificación facial.', ubicacion: 'service_outbox', consume: ['Notificaciones', 'VerificationArrivalConsumer'], estado: 'hecho' },
    EV_STARTED: { title: 'service_started', tipo: 'Evento de dominio', descripcion: 'El servicio comenzó. Habilita el checklist con fotos.', ubicacion: 'service_outbox', consume: ['ChecklistStartedConsumer'], estado: 'hecho' },
    C_NOTIF: { title: 'Consumidor de notificaciones', tipo: 'Consumer', descripcion: 'Relay de notificaciones que lee eventos del servicio y envía push e in-app.', tecnologia: 'NestJS + BullMQ', ubicacion: 'services/api/src/notifications', consume: ['service_en_route', 'service_arrived', 'verification_flagged'], produce: ['Push OneSignal'], estado: 'parcial', nota: 'Faltan credenciales de OneSignal.' },
    C_VARR: { title: 'VerificationArrivalConsumer', tipo: 'Consumer', descripcion: 'Al llegar el Cleaner crea la verificación facial.', tecnologia: 'NestJS', ubicacion: 'services/api/src/video-verification/consumers/verification-arrival.consumer.ts', consume: ['service_arrived'], produce: ['verification_completed', 'verification_flagged'], estado: 'hecho' },
    C_CHKSTART: { title: 'ChecklistStartedConsumer', tipo: 'Consumer', descripcion: 'Abre el checklist del servicio al iniciar y emite checklist_completed al terminar.', tecnologia: 'NestJS', ubicacion: 'services/api/src/checklist-photos/consumers/checklist-started.consumer.ts', consume: ['service_started', 'verification_completed'], produce: ['checklist_completed'], estado: 'hecho', nota: 'La emisión de checklist_completed desde este consumer se tomó de la cadena conocida; confirmar en código.' },
    VER_OB: { title: 'verification_outbox', tipo: 'Tabla outbox', descripcion: 'Eventos de la verificación facial.', tecnologia: 'PostgreSQL', ubicacion: 'services/api/src/video-verification/verification-outbox.ts', produce: ['verification_completed', 'verification_flagged'], estado: 'hecho' },
    EV_VERDONE: { title: 'verification_completed', tipo: 'Evento de dominio', descripcion: 'La identidad del Cleaner coincide.', ubicacion: 'verification_outbox', estado: 'hecho' },
    EV_VERFLAG: { title: 'verification_flagged', tipo: 'Evento de dominio', descripcion: 'La verificación no coincide o es dudosa; se notifica para revisión.', ubicacion: 'verification_outbox', consume: ['Notificaciones'], estado: 'hecho' },
    CHK_OB: { title: 'checklist_outbox', tipo: 'Tabla outbox', descripcion: 'Eventos del checklist con fotos.', tecnologia: 'PostgreSQL', ubicacion: 'services/api/src/checklist-photos', produce: ['checklist_completed'], estado: 'hecho', nota: 'No existe un archivo *-outbox.ts propio en este módulo; el nombre de tabla viene de la cadena conocida.' },
    EV_CHKDONE: { title: 'checklist_completed', tipo: 'Evento de dominio', descripcion: 'El Cleaner terminó el checklist con fotos.', ubicacion: 'checklist_outbox', consume: ['CompletionCreatedConsumer'], estado: 'hecho' },
    C_COMP: { title: 'CompletionCreatedConsumer', tipo: 'Consumer', descripcion: 'Crea el registro de cierre del servicio para confirmación o disputa.', tecnologia: 'NestJS', ubicacion: 'services/api/src/service-completion/consumers/completion-created.consumer.ts', consume: ['checklist_completed'], estado: 'hecho' },
    COMP_OB: { title: 'completion_outbox', tipo: 'Tabla outbox', descripcion: 'Resultado del cierre: confirmado, disputado o calificado.', tecnologia: 'PostgreSQL', ubicacion: 'services/api/src/service-completion/completion-outbox.ts', produce: ['service_confirmed', 'service_disputed', 'service_rated'], estado: 'hecho' },
    EV_CONF: { title: 'service_confirmed', tipo: 'Evento de dominio', descripcion: 'El Host confirmó el servicio. Genera la orden de liberar el pago.', ubicacion: 'completion_outbox', consume: ['ReleaseIntentWorker'], estado: 'hecho' },
    EV_DISP: { title: 'service_disputed', tipo: 'Evento de dominio', descripcion: 'El Host abrió una disputa.', ubicacion: 'completion_outbox', consume: ['DisputeCreatedConsumer'], estado: 'hecho' },
    EV_RATED: { title: 'service_rated', tipo: 'Evento de dominio', descripcion: 'Calificación registrada para el servicio.', ubicacion: 'completion_outbox', estado: 'hecho' },
    W_RELEASE: { title: 'ReleaseIntentWorker', tipo: 'Worker BullMQ', descripcion: 'Procesa la intención de liberación del pago en la cola de pagos diferidos.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/payments (release-intent.worker.ts)', consume: ['service_confirmed'], estado: 'hecho' },
    ESCROW_REL: { title: 'EscrowReleaseService', tipo: 'Servicio', descripcion: 'Libera el escrow al Cleaner vía Stripe Connect y escribe payment.released.', tecnologia: 'NestJS + Stripe', ubicacion: 'services/api/src/payments', produce: ['payment.released'], adr: 'ADR-005', estado: 'parcial', nota: 'Faltan credenciales reales de Stripe.' },
    PAY_OB: { title: 'payment_outbox', tipo: 'Tabla outbox', descripcion: 'Eventos de pagos: captured, released, failed, refunded, disputed.', tecnologia: 'PostgreSQL', ubicacion: 'services/api/src/payments/payment-outbox.ts', produce: ['payment.captured', 'payment.released', 'payment.failed', 'payment.refunded', 'payment.disputed'], estado: 'hecho' },
    EV_PAYREL: { title: 'payment.released', tipo: 'Evento de dominio', descripcion: 'El pago fue liberado al Cleaner.', ubicacion: 'payment_outbox', estado: 'hecho' },
    C_DISP: { title: 'DisputeCreatedConsumer', tipo: 'Consumer', descripcion: 'Crea la disputa y congela la liberación del pago hasta resolver.', tecnologia: 'NestJS', ubicacion: 'services/api/src/dispute-system/consumers/dispute-created.consumer.ts', consume: ['service_disputed'], estado: 'hecho' },
    REDIS: { title: 'Redis', tipo: 'Cache y colas', descripcion: 'Almacén de todas las colas BullMQ.', tecnologia: 'Redis 7', ubicacion: 'infra/docker-compose.yml (puerto 16379)', estado: 'hecho' },
    Q_RADIUS: { title: 'offer-radius-expansion', tipo: 'Cola BullMQ', descripcion: 'Amplía el radio de búsqueda de una oferta sin respuesta.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/offers (radius-expansion.processor.ts)', estado: 'hecho' },
    Q_TIER: { title: 'offer-tier-delivery', tipo: 'Cola BullMQ', descripcion: 'Entrega la oferta a Cleaners por niveles.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/offers (tier-delivery.processor.ts)', estado: 'hecho' },
    Q_FAVWIN: { title: 'offer-favorites-window', tipo: 'Cola BullMQ', descripcion: 'Cierra la ventana de prioridad para favoritos.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/offers (favorites-window.processor.ts)', estado: 'hecho' },
    Q_OFFPUSH: { title: 'offer-push-notification', tipo: 'Cola BullMQ', descripcion: 'Envía el push de oferta nueva.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/offers (push-notification.processor.ts)', estado: 'parcial', nota: 'Faltan credenciales de OneSignal.' },
    Q_STRIPEWH: { title: 'payments-stripe-webhook', tipo: 'Cola BullMQ', descripcion: 'Procesa webhooks de Stripe.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/payments (stripe-webhook.processor.ts)', estado: 'parcial', nota: 'Faltan credenciales de Stripe.' },
    Q_DEFREL: { title: 'payments-deferred-release', tipo: 'Cola BullMQ', descripcion: 'Liberación diferida y automática de pagos.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/payments (release-intent.worker.ts, auto-release.worker.ts)', estado: 'hecho' },
    Q_RCWH: { title: 'subscriptions-revenuecat-webhook', tipo: 'Cola BullMQ', descripcion: 'Procesa webhooks de RevenueCat.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/subscriptions (revenuecat-webhook.processor.ts)', estado: 'parcial', nota: 'Faltan credenciales de producción.' },
    Q_DELIVERY: { title: 'notifications-delivery', tipo: 'Cola BullMQ', descripcion: 'Entrega de notificaciones push e in-app.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/notifications (delivery.worker.ts)', estado: 'parcial', nota: 'Faltan credenciales de OneSignal.' },
    Q_TRANSCRIBE: { title: 'voice-notes-transcription', tipo: 'Cola BullMQ', descripcion: 'Transcribe notas de voz.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/chat (voice-transcription.processor.ts)', estado: 'parcial', nota: 'Whisper aún no está desplegado.' },
    Q_VOICECLEAN: { title: 'voice-notes-cleanup', tipo: 'Cola BullMQ', descripcion: 'Limpieza de notas de voz vencidas.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/chat (voice-note-cleanup.processor.ts)', estado: 'hecho' },
    Q_VOIPSWEEP: { title: 'voip-calls-sweep', tipo: 'Cola BullMQ', descripcion: 'Barrido de llamadas colgadas o vencidas.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/chat/voip (voip-sweep.processor.ts)', estado: 'hecho' },
    Q_TRACKSWEEP: { title: 'service-tracking-sweep', tipo: 'Cola BullMQ', descripcion: 'Barrido de sesiones de servicio atascadas.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/service-tracking (service-sweep.processor.ts)', estado: 'hecho' },
    Q_FACE: { title: 'video-face-comparison', tipo: 'Cola BullMQ', descripcion: 'Comparación facial contra el microservicio de IA.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/video-verification (face-comparison.processor.ts)', estado: 'hecho' },
    Q_PHOTOCLEAN: { title: 'checklist-photos-cleanup', tipo: 'Cola BullMQ', descripcion: 'Limpieza de fotos de checklist y permisos de subida vencidos.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/checklist-photos', estado: 'hecho' },
    Q_COMPLETION: { title: 'service-completion', tipo: 'Cola BullMQ', descripcion: 'Trabajos de cierre: autoconfirmación y barridos.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/service-completion', estado: 'hecho' },
    Q_DISPUTE: { title: 'dispute-system', tipo: 'Cola BullMQ', descripcion: 'SLA de disputas y retención de evidencia.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/dispute-system (dispute-sla-sweep.processor.ts)', estado: 'hecho' },
  },
  sections: [
    {
      title: 'Otras tablas outbox',
      html: '<p>Además de la cadena principal existen <code>negotiation_outbox</code> (propuestas creadas, contraofertadas, rechazadas, aceptadas), '
        + '<code>chat_outbox</code> y <code>voip_outbox</code>. Todas usan <code>OutboxWriter</code> de <code>packages/shared/src/outbox</code>.</p>',
    },
  ],
});
