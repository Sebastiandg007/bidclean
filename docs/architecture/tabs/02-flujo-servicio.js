/**
 * 02-flujo-servicio.js — diagrama de flujo del sistema de punta a punta:
 * desde que el Host publica una oferta hasta que el dinero se libera o se disputa.
 */
BidCleanArch.registerTab({
  id: 'flujo-servicio',
  group: 'Visión general',
  order: 20,
  title: 'Flujo del servicio (E2E)',
  summary:
    'Diagrama de flujo a nivel de sistema: qué componente actúa en cada paso, qué evento emite y quién lo consume. '
    + 'Los eventos viajan por tablas outbox transaccionales; los pasos asíncronos los ejecutan workers BullMQ.',
  diagrams: [
    {
      title: 'Flujo completo: publicación → pago → cierre',
      description: 'Rombos = decisiones. Las etiquetas de las flechas son los eventos de dominio.',
      code: `flowchart TD
  INICIO(["Host publica oferta"])
  PUBLICAR["OffersService.create<br/>valida precio y propiedad"]
  RADAR["Radar de ofertas<br/>Centrifugo + push"]
  EXPANSION["RadiusExpansionProcessor<br/>amplía el radio PostGIS"]
  NIVELES["TierDeliveryProcessor<br/>favoritos → PRO → resto"]
  DECIDE{"¿Cleaner acepta<br/>o negocia?"}
  NEGOCIAR["NegotiationService<br/>contraoferta"]
  ACUERDO{"¿Hay acuerdo?"}
  EXPIRA(["Oferta expira"])
  MATCH["Oferta emparejada"]
  LISTENER["OfferMatchedListener"]
  COBRO["EscrowChargeService<br/>cobro + retención Stripe"]
  STRIPE_EXT["Stripe Connect"]
  ACTIVA["ServiceActivationConsumer<br/>crea la sesión de servicio"]
  ENCAMINO["Cleaner en camino<br/>GPS en tiempo real"]
  LLEGA["Cleaner llega"]
  VIDEO["VerificationArrivalConsumer<br/>verificación facial"]
  IA_FACE["Microservicio IA<br/>/verify-face"]
  VERIF{"¿Rostro verificado?"}
  INICIA["Servicio iniciado"]
  CHECK["ChecklistStartedConsumer<br/>checklist + fotos"]
  CHECKOK["Checklist completado"]
  CIERRE["CompletionCreatedConsumer<br/>registro de cierre"]
  HOSTDEC{"¿Host satisfecho?"}
  RATING["Calificación mutua"]
  INTENT["ReleaseIntentWorker"]
  LIBERA["EscrowReleaseService.release<br/>pago al Cleaner − comisión 13%"]
  FIN(["Pago liberado"])
  DISPUTA["DisputeCreatedConsumer<br/>abre disputa"]
  RESUELVE{"Resolución"}
  REEMBOLSO(["Reembolso al Host"])
  NOTIF["NotificationsModule<br/>push OneSignal"]

  INICIO --> PUBLICAR -->|offer.published| RADAR
  RADAR --> NIVELES
  RADAR -->|sin respuesta| EXPANSION --> RADAR
  NIVELES --> DECIDE
  DECIDE -->|negocia| NEGOCIAR --> ACUERDO
  ACUERDO -->|no| EXPIRA
  ACUERDO -->|sí| MATCH
  DECIDE -->|acepta| MATCH
  MATCH -->|offer.matched| LISTENER --> COBRO
  COBRO <--> STRIPE_EXT
  COBRO -->|service_activation_ready| ACTIVA
  ACTIVA -->|service_en_route| ENCAMINO
  ENCAMINO -->|service_arrived| LLEGA
  LLEGA --> VIDEO <--> IA_FACE
  VIDEO --> VERIF
  VERIF -->|no| DISPUTA
  VERIF -->|verification_completed| INICIA
  INICIA -->|service_started| CHECK
  CHECK -->|checklist_completed| CHECKOK --> CIERRE
  CIERRE --> HOSTDEC
  HOSTDEC -->|service_confirmed| RATING
  RATING -->|service_rated| INTENT
  HOSTDEC -->|sin respuesta: auto-liberación| INTENT
  INTENT --> LIBERA -->|payment.released| FIN
  HOSTDEC -->|service_disputed| DISPUTA
  DISPUTA --> RESUELVE
  RESUELVE -->|a favor del Cleaner| LIBERA
  RESUELVE -->|a favor del Host| REEMBOLSO
  ACTIVA -.-> NOTIF
  LLEGA -.-> NOTIF
  INICIA -.-> NOTIF
  FIN -.-> NOTIF`,
    },
    {
      title: 'Movimiento del dinero',
      description: 'El cobro ocurre al emparejar; el dinero queda retenido hasta la confirmación o la resolución de la disputa.',
      code: `flowchart LR
  HOST["Host<br/>paga precio + 10%"]
  ESCROW["Escrow Stripe<br/>dinero retenido"]
  PLAT["BidClean<br/>comisión 13%"]
  CLEANER["Cleaner<br/>recibe precio − 3%"]
  HOST -->|cobro al emparejar| ESCROW
  ESCROW -->|liberación| CLEANER
  ESCROW -->|comisión| PLAT
  ESCROW -.->|disputa a favor del Host| HOST`,
    },
  ],
  nodes: {
    INICIO: { title: 'Host publica oferta', tipo: 'Inicio', descripcion: 'El Host elige propiedad, tipo de limpieza, fecha y propone un precio.', ubicacion: 'apps/mobile/src/screens/offers', estado: 'hecho' },
    PUBLICAR: { title: 'OffersService.create', tipo: 'Servicio NestJS', descripcion: 'Valida la oferta, la guarda y escribe el evento en offer_outbox en la misma transacción.', ubicacion: 'services/api/src/offers/offers.service.ts', produce: ['offer.published'], estado: 'hecho' },
    RADAR: { title: 'Radar de ofertas', tipo: 'Tiempo real', descripcion: 'Los Cleaners cercanos reciben la oferta al instante por WebSocket y push.', tecnologia: 'Centrifugo + OneSignal', ubicacion: 'apps/mobile/src/screens/radar', estado: 'hecho' },
    EXPANSION: { title: 'RadiusExpansionProcessor', tipo: 'Worker BullMQ', descripcion: 'Si nadie responde, amplía el radio de búsqueda geográfica por etapas.', tecnologia: 'BullMQ (offer-radius-expansion) + PostGIS', ubicacion: 'services/api/src/offers/expansion/radius-expansion.processor.ts', estado: 'hecho' },
    NIVELES: { title: 'TierDeliveryProcessor', tipo: 'Worker BullMQ', descripcion: 'Entrega escalonada: primero favoritos (ventana de prioridad), luego PRO y luego el resto.', tecnologia: 'BullMQ (offer-tier-delivery, offer-favorites-window)', ubicacion: 'services/api/src/offers/delivery', estado: 'hecho' },
    DECIDE: { title: 'Decisión del Cleaner', tipo: 'Decisión', descripcion: 'El Cleaner acepta el precio o envía una contraoferta.', estado: 'hecho' },
    NEGOCIAR: { title: 'NegotiationService', tipo: 'Servicio NestJS', descripcion: 'Gestiona contraofertas y su expiración.', ubicacion: 'services/api/src/negotiation/negotiation.service.ts', estado: 'hecho' },
    ACUERDO: { title: '¿Hay acuerdo?', tipo: 'Decisión', descripcion: 'Si la propuesta vence sin respuesta, proposal-expiry.worker la cierra.', ubicacion: 'services/api/src/negotiation/expiration/proposal-expiry.worker.ts', estado: 'hecho' },
    EXPIRA: { title: 'Oferta expira', tipo: 'Fin', descripcion: 'No hubo acuerdo; no se cobra nada.', estado: 'hecho' },
    MATCH: { title: 'Oferta emparejada', tipo: 'Estado', descripcion: 'Host y Cleaner quedan vinculados. Se emite offer.matched.', produce: ['offer.matched'], estado: 'hecho' },
    LISTENER: { title: 'OfferMatchedListener', tipo: 'Consumidor de eventos', descripcion: 'Escucha offer.matched y dispara el cobro en escrow.', ubicacion: 'services/api/src/payments/listeners/offer-matched.listener.ts', consume: ['offer.matched'], estado: 'hecho' },
    COBRO: { title: 'EscrowChargeService', tipo: 'Servicio NestJS', descripcion: 'Cobra al Host y retiene el dinero en Stripe. Emite service_activation_ready.', ubicacion: 'services/api/src/payments/escrow/escrow-charge.service.ts', produce: ['service_activation_ready'], adr: 'ADR-005', estado: 'parcial', nota: 'Requiere llaves reales de Stripe.' },
    STRIPE_EXT: { title: 'Stripe Connect', tipo: 'Servicio externo', descripcion: 'Procesa el cobro y devuelve webhooks (cola payments-stripe-webhook).', estado: 'externo' },
    ACTIVA: { title: 'ServiceActivationConsumer', tipo: 'Consumidor de eventos', descripcion: 'Crea la sesión de servicio cuando el pago está retenido.', ubicacion: 'services/api/src/service-tracking/service-activation.consumer.ts', consume: ['service_activation_ready'], produce: ['service_en_route'], estado: 'hecho' },
    ENCAMINO: { title: 'Cleaner en camino', tipo: 'Seguimiento', descripcion: 'La app del Cleaner envía GPS; el Host lo ve en el mapa en tiempo real.', tecnologia: 'Centrifugo + Mapbox', ubicacion: 'apps/mobile/src/screens/tracking', produce: ['service_arrived'], estado: 'hecho' },
    LLEGA: { title: 'Cleaner llega', tipo: 'Estado', descripcion: 'Se emite service_arrived (service_outbox). Lo consumen notificaciones y verificación por video.', produce: ['service_arrived'], estado: 'hecho' },
    VIDEO: { title: 'VerificationArrivalConsumer', tipo: 'Consumidor de eventos', descripcion: 'Pide al Cleaner un video/selfie y lo compara con su KYC.', ubicacion: 'services/api/src/video-verification/consumers/verification-arrival.consumer.ts', consume: ['service_arrived'], produce: ['verification_completed'], estado: 'hecho' },
    IA_FACE: { title: 'IA /verify-face', tipo: 'Endpoint FastAPI', descripcion: 'Compara el rostro del video con la foto del documento (cola video-face-comparison).', ubicacion: 'services/ai/src/video_verification', estado: 'parcial' },
    VERIF: { title: '¿Rostro verificado?', tipo: 'Decisión', descripcion: 'Si falla la verificación, el caso pasa a disputa.', estado: 'hecho' },
    INICIA: { title: 'Servicio iniciado', tipo: 'Estado', descripcion: 'Comienza la limpieza. Se emite service_started.', produce: ['service_started'], estado: 'hecho' },
    CHECK: { title: 'ChecklistStartedConsumer', tipo: 'Consumidor de eventos', descripcion: 'Abre el checklist con fotos antes/después en MinIO.', ubicacion: 'services/api/src/checklist-photos/consumers/checklist-started.consumer.ts', consume: ['service_started'], produce: ['checklist_completed'], estado: 'hecho' },
    CHECKOK: { title: 'Checklist completado', tipo: 'Estado', descripcion: 'Todas las tareas con su evidencia (checklist_outbox).', produce: ['checklist_completed'], estado: 'hecho' },
    CIERRE: { title: 'CompletionCreatedConsumer', tipo: 'Consumidor de eventos', descripcion: 'Crea el registro de cierre y espera la respuesta del Host.', ubicacion: 'services/api/src/service-completion/consumers/completion-created.consumer.ts', consume: ['checklist_completed'], estado: 'hecho' },
    HOSTDEC: { title: '¿Host satisfecho?', tipo: 'Decisión', descripcion: 'El Host confirma o disputa. Si no responde, auto-release-sweep libera el pago al vencer el plazo.', ubicacion: 'services/api/src/service-completion/jobs/auto-release-sweep.processor.ts', produce: ['service_confirmed', 'service_disputed'], estado: 'hecho' },
    RATING: { title: 'Calificación mutua', tipo: 'Paso', descripcion: 'Host y Cleaner se califican (completion_outbox).', produce: ['service_rated'], estado: 'hecho' },
    INTENT: { title: 'ReleaseIntentWorker', tipo: 'Worker BullMQ', descripcion: 'Procesa la intención de liberar el pago de forma idempotente.', ubicacion: 'services/api/src/service-completion/jobs/release-intent.worker.ts', estado: 'hecho' },
    LIBERA: { title: 'EscrowReleaseService.release', tipo: 'Servicio NestJS', descripcion: 'Transfiere al Cleaner descontando la comisión. Emite payment.released.', ubicacion: 'services/api/src/payments/escrow/escrow-release.service.ts', produce: ['payment.released'], estado: 'parcial', nota: 'Requiere llaves reales de Stripe.' },
    FIN: { title: 'Pago liberado', tipo: 'Fin', descripcion: 'El servicio queda cerrado y pagado.', estado: 'hecho' },
    DISPUTA: { title: 'DisputeCreatedConsumer', tipo: 'Consumidor de eventos', descripcion: 'Abre la disputa, congela el pago y gestiona evidencia y SLA.', ubicacion: 'services/api/src/dispute-system/consumers/dispute-created.consumer.ts', consume: ['service_disputed'], estado: 'hecho' },
    RESUELVE: { title: 'Resolución de la disputa', tipo: 'Decisión', descripcion: 'escrow-intent.worker y financial-intent.worker ejecutan la decisión.', ubicacion: 'services/api/src/dispute-system/jobs', estado: 'hecho' },
    REEMBOLSO: { title: 'Reembolso al Host', tipo: 'Fin', descripcion: 'El dinero retenido vuelve al Host.', estado: 'hecho' },
    NOTIF: { title: 'NotificationsModule', tipo: 'Módulo NestJS', descripcion: 'Avisa a cada parte en cada cambio de estado (cola notifications-delivery).', tecnologia: 'OneSignal', ubicacion: 'services/api/src/notifications', estado: 'parcial', nota: 'Faltan credenciales de OneSignal.' },
    HOST: { title: 'Host', tipo: 'Actor', descripcion: 'Paga el precio acordado más el 10% de comisión.', estado: 'hecho' },
    ESCROW: { title: 'Escrow Stripe', tipo: 'Retención', descripcion: 'El dinero queda retenido hasta la confirmación.', adr: 'ADR-005', estado: 'parcial' },
    PLAT: { title: 'BidClean', tipo: 'Plataforma', descripcion: 'Recibe el 13% total (10% Host + 3% Cleaner).', ubicacion: 'services/api/src/commission', estado: 'hecho' },
    CLEANER: { title: 'Cleaner', tipo: 'Actor', descripcion: 'Recibe el precio acordado menos el 3%.', estado: 'hecho' },
  },
});
