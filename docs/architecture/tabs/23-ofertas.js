/**
 * 23-ofertas.js — ofertas: OffersModule + NegotiationModule (NestJS) y pantallas offers, radar y negotiation del móvil.
 */
BidCleanArch.registerTab({
  id: 'ofertas',
  group: 'Dominios del negocio',
  order: 230,
  title: 'Ofertas y negociación',
  summary:
    'El Host publica una oferta con un precio propuesto; la API la lleva por una máquina de estados '
    + '(<code>DRAFT → PUBLISHED → ACTIVE → MATCHED</code>, con salidas a <code>EXPIRED</code> y <code>CANCELLED</code>) y emite un evento de dominio por cada transición. '
    + 'La entrega a los Cleaners cercanos se hace con colas BullMQ por niveles, con expansión progresiva del radio y push por OneSignal. '
    + 'Un Cleaner puede aceptar directamente o negociar con contraofertas; al aceptarse, <code>offer.matched</code> dispara el cobro en escrow (ver Pagos).',
  diagrams: [
    {
      title: 'Ciclo de vida de una oferta',
      description: 'Estados de la oferta y el evento de dominio que se emite en cada transición. Todas las transiciones se validan en la máquina de estados.',
      code: `flowchart TD
  O_CREATE["CreateOfferScreen<br/>propiedad, servicio, duración y precio"]
  O_POST["POST /offers<br/>crea el borrador"]
  O_DRAFT["Oferta DRAFT<br/>evento offer.created"]
  O_SM["offer-state-machine<br/>valida cada transición"]
  O_PUBLISHED["Oferta PUBLISHED<br/>POST /offers/:id/publish<br/>evento offer.published"]
  O_ACTIVE["Oferta ACTIVE<br/>visible en el radar<br/>evento offer.activated"]
  O_DECIDE{"¿Un Cleaner acepta?"}
  O_MATCHED["Oferta MATCHED<br/>evento offer.matched"]
  O_PAY["PaymentsModule<br/>cobro en escrow"]
  O_EXPIRED["Oferta EXPIRED<br/>evento offer.expired"]
  O_CANCELLED["Oferta CANCELLED<br/>POST /offers/:id/cancel<br/>evento offer.cancelled"]

  O_CREATE --> O_POST --> O_DRAFT
  O_SM -.-> O_DRAFT
  O_DRAFT -->|publicar| O_PUBLISHED --> O_ACTIVE --> O_DECIDE
  O_DECIDE -->|sí| O_MATCHED --> O_PAY
  O_DECIDE -->|no, se agota el radio y la espera| O_EXPIRED
  O_DRAFT -->|cancelar| O_CANCELLED
  O_PUBLISHED -->|cancelar| O_CANCELLED
  O_ACTIVE -->|cancelar| O_CANCELLED`,
    },
    {
      title: 'Entrega a Cleaners, expansión de radio y push',
      description: 'Cuatro colas BullMQ separan la entrega por niveles, la ventana de favoritos, la expansión del radio y las notificaciones push.',
      code: `flowchart LR
  Q_SVC["OffersService<br/>orquesta la oferta"]
  Q_EVENTS["offer-domain-events<br/>EventEmitter2"]
  Q_OUTBOX[("offer-outbox<br/>eventos pendientes en PostgreSQL")]
  Q_DISC["CleanerDiscoveryService<br/>Cleaners cercanos con PostGIS"]
  Q_TIERQ["Cola offer-tier-delivery"]
  Q_TIER["tier-delivery.processor<br/>entrega por nivel PRO y gratis"]
  Q_FAVQ["Cola offer-favorites-window"]
  Q_FAV["favorites-window.processor<br/>ventana exclusiva para favoritos"]
  Q_EXPQ["Cola offer-radius-expansion"]
  Q_EXP["radius-expansion.processor<br/>amplía el radio cada 5 min"]
  Q_PUSHQ["Cola offer-push-notification"]
  Q_PUSH["push-notification.processor<br/>envía push"]
  Q_ONE["OneSignal<br/>notificaciones push"]
  Q_CENT["Centrifugo<br/>canal en tiempo real"]
  Q_RADAR["RadarScreen<br/>mapa y lista del Cleaner"]

  Q_SVC --> Q_EVENTS
  Q_SVC --> Q_OUTBOX
  Q_SVC --> Q_FAVQ --> Q_FAV --> Q_TIERQ
  Q_SVC --> Q_TIERQ --> Q_TIER
  Q_TIER --> Q_DISC
  Q_TIER --> Q_CENT --> Q_RADAR
  Q_TIER --> Q_PUSHQ --> Q_PUSH --> Q_ONE
  Q_TIER --> Q_EXPQ --> Q_EXP
  Q_EXP --> Q_DISC
  Q_EXP --> Q_TIERQ`,
    },
    {
      title: 'Negociación con contraofertas',
      description: 'El Cleaner propone un precio distinto; el Host acepta, rechaza o responde con otra contraoferta. Las propuestas sin respuesta expiran solas.',
      code: `flowchart TD
  N_SCREEN["CleanerNegotiationScreen<br/>envía contraoferta"]
  N_INBOX["HostCounterofferInboxScreen<br/>bandeja del Host"]
  N_SVC["NegotiationService<br/>hilos y propuestas"]
  N_PRICE["negotiation-pricing.service<br/>calcula pago neto del Cleaner"]
  N_DECIDE{"¿Qué decide el Host?"}
  N_ACCEPTED["Propuesta aceptada<br/>la oferta pasa a MATCHED"]
  N_REJECTED["Propuesta rechazada"]
  N_COUNTERED["Nueva contraoferta del Host<br/>vuelve al Cleaner"]
  N_EXPIRY["proposal-expiry.worker<br/>expira propuestas vencidas"]

  N_SCREEN -->|POST counteroffers| N_SVC
  N_SVC --> N_PRICE
  N_SVC --> N_INBOX --> N_DECIDE
  N_DECIDE -->|aceptar| N_ACCEPTED
  N_DECIDE -->|rechazar| N_REJECTED
  N_DECIDE -->|contraofertar| N_COUNTERED --> N_SCREEN
  N_EXPIRY -.-> N_SVC`,
    },
  ],
  nodes: {
    O_CREATE: { title: 'CreateOfferScreen', tipo: 'Pantalla móvil', descripcion: 'Formulario del Host: elige la propiedad, el tipo de servicio, la duración y el precio. Muestra el desglose de precio y confirma en OfferConfirmationScreen.', tecnologia: 'React Native + Zustand', ubicacion: 'apps/mobile/src/screens/offers/CreateOfferScreen.tsx', estado: 'hecho' },
    O_POST: { title: 'POST /offers', tipo: 'Endpoint', descripcion: 'Crea la oferta en estado DRAFT. Requiere propiedad lista (contrato property-readiness) y calcula el desglose de comisión.', ubicacion: 'services/api/src/offers/offers.controller.ts', consume: ['CreateOfferDto'], produce: ['oferta DRAFT'], estado: 'hecho' },
    O_DRAFT: { title: 'Oferta DRAFT', tipo: 'Estado', descripcion: 'Borrador del Host. Emite offer.created. Aún no es visible para los Cleaners.', ubicacion: 'services/api/src/offers/entities/offer.entity.ts', produce: ['offer.created'], estado: 'hecho' },
    O_SM: { title: 'offer-state-machine', tipo: 'Máquina de estados', descripcion: 'Función pura que define las transiciones válidas de la oferta; el servicio la consulta antes de cada cambio y registra la transición en offer_state_transitions.', ubicacion: 'services/api/src/offers/state-machine/offer-state-machine.ts', estado: 'hecho' },
    O_PUBLISHED: { title: 'Oferta PUBLISHED', tipo: 'Estado', descripcion: 'El Host publicó la oferta con POST /offers/:id/publish. Emite offer.published y programa la entrega a Cleaners.', ubicacion: 'services/api/src/offers/offers.service.ts', produce: ['offer.published'], estado: 'hecho' },
    O_ACTIVE: { title: 'Oferta ACTIVE', tipo: 'Estado', descripcion: 'La oferta ya está en entrega y visible en el radar. Emite offer.activated.', ubicacion: 'services/api/src/offers/offers.service.ts', produce: ['offer.activated'], estado: 'hecho' },
    O_DECIDE: { title: '¿Un Cleaner acepta?', tipo: 'Decisión', descripcion: 'Un Cleaner acepta directamente (POST /negotiation/offers/:offerId/accept) o se llega a un acuerdo por contraoferta. Si nadie acepta tras agotar la expansión de radio y la espera final, la oferta expira.', estado: 'hecho' },
    O_MATCHED: { title: 'Oferta MATCHED', tipo: 'Estado', descripcion: 'Hay un Cleaner asignado y un precio acordado. Emite offer.matched, que consume PaymentsModule.', ubicacion: 'services/api/src/offers/events/offer-domain-events.ts', produce: ['offer.matched'], estado: 'hecho' },
    O_PAY: { title: 'PaymentsModule', tipo: 'Módulo consumidor', descripcion: 'OfferMatchedListener escucha offer.matched y crea el cobro en escrow. Detalle en la pestaña Pagos.', ubicacion: 'services/api/src/payments/listeners/offer-matched.listener.ts', consume: ['offer.matched'], estado: 'parcial', nota: 'Sin claves reales de Stripe el cobro no se ejecuta contra Stripe.' },
    O_EXPIRED: { title: 'Oferta EXPIRED', tipo: 'Estado', descripcion: 'Nadie aceptó. Emite offer.expired; NegotiationModule cierra las propuestas abiertas con OfferTerminalListener.', ubicacion: 'services/api/src/offers/offers.service.ts', produce: ['offer.expired'], estado: 'hecho' },
    O_CANCELLED: { title: 'Oferta CANCELLED', tipo: 'Estado', descripcion: 'El Host canceló con POST /offers/:id/cancel (solo el dueño, guard OfferOwnerGuard). Emite offer.cancelled.', ubicacion: 'services/api/src/offers/offers.controller.ts', produce: ['offer.cancelled'], estado: 'hecho' },

    Q_SVC: { title: 'OffersService', tipo: 'Servicio NestJS', descripcion: 'Crea, publica y cancela ofertas, aplica la máquina de estados y programa los jobs de entrega.', ubicacion: 'services/api/src/offers/offers.service.ts', estado: 'hecho' },
    Q_EVENTS: { title: 'offer-domain-events', tipo: 'Eventos de dominio', descripcion: 'Constantes y tipos de offer.created, published, activated, matched, cancelled, expired (y completed). Se emiten con EventEmitter2 para que otros módulos reaccionen sin acoplarse.', tecnologia: 'EventEmitter2', ubicacion: 'services/api/src/offers/events/offer-domain-events.ts', produce: ['offer.*'], estado: 'hecho' },
    Q_OUTBOX: { title: 'offer-outbox', tipo: 'Outbox', descripcion: 'Registra las notificaciones y eventos dentro de la misma transacción de la oferta para no perderlos si el proceso cae.', tecnologia: 'PostgreSQL', ubicacion: 'services/api/src/offers/notification/offer-outbox.ts', estado: 'hecho' },
    Q_DISC: { title: 'CleanerDiscoveryService', tipo: 'Servicio NestJS', descripcion: 'Busca Cleaners dentro del radio de la oferta con consultas geoespaciales.', tecnologia: 'PostGIS', ubicacion: 'services/api/src/offers/discovery/cleaner-discovery.service.ts', estado: 'hecho' },
    Q_TIERQ: { title: 'Cola offer-tier-delivery', tipo: 'Cola BullMQ', descripcion: 'Jobs deliver-to-tier. Retrasa la entrega a usuarios gratis (por defecto 120 s) respecto a PRO.', tecnologia: 'BullMQ + Redis', ubicacion: 'services/api/src/offers/offers.constants.ts', estado: 'hecho' },
    Q_TIER: { title: 'tier-delivery.processor', tipo: 'Worker BullMQ', descripcion: 'Entrega la oferta a los Cleaners de un nivel, la publica por Centrifugo y encola el push.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/offers/delivery/tier-delivery.processor.ts', consume: ['offer-tier-delivery'], estado: 'hecho' },
    Q_FAVQ: { title: 'Cola offer-favorites-window', tipo: 'Cola BullMQ', descripcion: 'Job favorites-expired que cierra la ventana exclusiva de favoritos (por defecto 180 s).', tecnologia: 'BullMQ + Redis', ubicacion: 'services/api/src/offers/offers.constants.ts', estado: 'hecho' },
    Q_FAV: { title: 'favorites-window.processor', tipo: 'Worker BullMQ', descripcion: 'Al vencer la ventana de favoritos libera la oferta al resto de Cleaners.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/offers/delivery/favorites-window.processor.ts', consume: ['offer-favorites-window'], estado: 'hecho' },
    Q_EXPQ: { title: 'Cola offer-radius-expansion', tipo: 'Cola BullMQ', descripcion: 'Job expand-radius repetido cada OFFER_EXPANSION_INTERVAL_MS (300000 ms por defecto).', tecnologia: 'BullMQ + Redis', ubicacion: 'services/api/src/offers/offers.constants.ts', estado: 'hecho' },
    Q_EXP: { title: 'radius-expansion.processor', tipo: 'Worker BullMQ', descripcion: 'Amplía el radio de búsqueda, entrega a los nuevos Cleaners y, tras la espera final, expira la oferta. Usa stale-job.guard para ignorar jobs de ofertas ya cerradas.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/offers/expansion/radius-expansion.processor.ts', consume: ['offer-radius-expansion'], estado: 'hecho' },
    Q_PUSHQ: { title: 'Cola offer-push-notification', tipo: 'Cola BullMQ', descripcion: 'Job send-push con reintentos y backoff exponencial.', tecnologia: 'BullMQ + Redis', ubicacion: 'services/api/src/offers/offers.constants.ts', estado: 'hecho' },
    Q_PUSH: { title: 'push-notification.processor', tipo: 'Worker BullMQ', descripcion: 'Toma los jobs de push y los envía por OneSignal mediante OfferNotificationService.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/offers/notification/push-notification.processor.ts', consume: ['offer-push-notification'], produce: ['push OneSignal'], estado: 'parcial', nota: 'Depende de credenciales reales de OneSignal.' },
    Q_ONE: { title: 'OneSignal', tipo: 'Servicio externo', descripcion: 'Proveedor de notificaciones push a iOS y Android.', tecnologia: 'OneSignal', ubicacion: 'services/api/src/offers/notification/onesignal.client.ts', estado: 'externo' },
    Q_CENT: { title: 'Centrifugo', tipo: 'Tiempo real', descripcion: 'Publica las ofertas nuevas a los Cleaners conectados por WebSocket (centrifugo.client.ts).', tecnologia: 'Centrifugo v5', ubicacion: 'services/api/src/offers/delivery/centrifugo.client.ts', estado: 'hecho' },
    Q_RADAR: { title: 'RadarScreen', tipo: 'Pantalla móvil', descripcion: 'Mapa Mapbox con pines y clusters y vista de lista con filtros de distancia, precio, fecha y tipo de servicio. Se suscribe al canal con useCentrifugoChannel y reconcilia con useRadarReconciliation; la lista incluye el espacio de anuncios para usuarios gratis.', tecnologia: 'React Native + Mapbox + Zustand', ubicacion: 'apps/mobile/src/screens/radar/RadarScreen.tsx', estado: 'hecho' },

    N_SCREEN: { title: 'CleanerNegotiationScreen', tipo: 'Pantalla móvil', descripcion: 'El Cleaner acepta el precio original o envía una contraoferta; muestra la vista previa de su pago neto (PayoutPreview).', ubicacion: 'apps/mobile/src/screens/negotiation/CleanerNegotiationScreen.tsx', estado: 'hecho' },
    N_INBOX: { title: 'HostCounterofferInboxScreen', tipo: 'Pantalla móvil', descripcion: 'Bandeja del Host con las contraofertas recibidas (GET /negotiation/host/counteroffers) y acciones de aceptar, rechazar o contraofertar.', ubicacion: 'apps/mobile/src/screens/negotiation/HostCounterofferInboxScreen.tsx', estado: 'hecho' },
    N_SVC: { title: 'NegotiationService', tipo: 'Servicio NestJS', descripcion: 'Gestiona hilos y propuestas con máquina de estados propia e idempotencia; publica eventos por su outbox.', ubicacion: 'services/api/src/negotiation/negotiation.service.ts', estado: 'hecho' },
    N_PRICE: { title: 'negotiation-pricing.service', tipo: 'Servicio NestJS', descripcion: 'Calcula el pago neto del Cleaner de cada propuesta con el servicio de comisión.', ubicacion: 'services/api/src/negotiation/pricing/negotiation-pricing.service.ts', estado: 'hecho' },
    N_DECIDE: { title: '¿Qué decide el Host?', tipo: 'Decisión', descripcion: 'Aceptar (POST /negotiation/proposals/:proposalId/accept), rechazar (…/reject) o contraofertar (…/counter).', estado: 'hecho' },
    N_ACCEPTED: { title: 'Propuesta aceptada', tipo: 'Estado', descripcion: 'La oferta pasa a MATCHED con el precio de la propuesta y se emite offer.matched.', estado: 'hecho' },
    N_REJECTED: { title: 'Propuesta rechazada', tipo: 'Estado', descripcion: 'La propuesta se cierra; el Cleaner puede enviar otra mientras la oferta siga activa.', estado: 'hecho' },
    N_COUNTERED: { title: 'Nueva contraoferta del Host', tipo: 'Estado', descripcion: 'El Host responde con otro precio y la negociación continúa. DTO host-counter.dto.ts.', ubicacion: 'services/api/src/negotiation/dto/host-counter.dto.ts', estado: 'hecho' },
    N_EXPIRY: { title: 'proposal-expiry.worker', tipo: 'Worker programado', descripcion: 'Barrido periódico con @Interval que expira propuestas vencidas.', tecnologia: 'NestJS Schedule', ubicacion: 'services/api/src/negotiation/expiration/proposal-expiry.worker.ts', estado: 'hecho' },
  },
  sections: [
    {
      title: 'Endpoints de ofertas y negociación',
      html: `<table>
<thead><tr><th>Método</th><th>Ruta</th><th>Descripción</th></tr></thead>
<tbody>
<tr><td>POST</td><td><code>/offers</code></td><td>Crea una oferta en borrador</td></tr>
<tr><td>POST</td><td><code>/offers/:id/publish</code></td><td>Publica la oferta y programa la entrega</td></tr>
<tr><td>POST</td><td><code>/offers/:id/cancel</code></td><td>Cancela la oferta (solo el Host dueño)</td></tr>
<tr><td>GET</td><td><code>/offers</code></td><td>Lista las ofertas del Host</td></tr>
<tr><td>GET</td><td><code>/offers/:id</code></td><td>Detalle de una oferta</td></tr>
<tr><td>GET</td><td><code>/offers/:id/price-breakdown</code></td><td>Desglose de precio y comisión</td></tr>
<tr><td>GET</td><td><code>/offers/available</code></td><td>Ofertas disponibles para el radar del Cleaner</td></tr>
<tr><td>GET</td><td><code>/offers/available/snapshot</code></td><td>Instantánea para reconciliar el radar</td></tr>
<tr><td>POST</td><td><code>/negotiation/offers/:offerId/accept</code></td><td>El Cleaner acepta el precio original</td></tr>
<tr><td>POST</td><td><code>/negotiation/offers/:offerId/counteroffers</code></td><td>El Cleaner envía una contraoferta</td></tr>
<tr><td>POST</td><td><code>/negotiation/proposals/:proposalId/accept</code></td><td>El Host acepta una propuesta</td></tr>
<tr><td>POST</td><td><code>/negotiation/proposals/:proposalId/reject</code></td><td>El Host rechaza una propuesta</td></tr>
<tr><td>POST</td><td><code>/negotiation/proposals/:proposalId/counter</code></td><td>El Host responde con otro precio</td></tr>
<tr><td>GET</td><td><code>/negotiation/offers/:offerId/thread</code></td><td>Hilo de negociación de una oferta</td></tr>
<tr><td>GET</td><td><code>/negotiation/host/counteroffers</code></td><td>Contraofertas pendientes del Host</td></tr>
</tbody></table>`,
    },
    {
      title: 'Colas, eventos y pantallas',
      html: `<ul>
<li><strong>Colas BullMQ:</strong> <code>offer-radius-expansion</code>, <code>offer-tier-delivery</code>, <code>offer-favorites-window</code>, <code>offer-push-notification</code>. Reintentos con backoff exponencial configurable por entorno.</li>
<li><strong>Eventos:</strong> <code>offer.created</code>, <code>offer.published</code>, <code>offer.activated</code>, <code>offer.matched</code>, <code>offer.cancelled</code>, <code>offer.expired</code> (además existe <code>offer.completed</code>).</li>
<li><strong>Tiempos por entorno:</strong> <code>OFFER_EXPANSION_INTERVAL_MS</code> (300000), <code>OFFER_FINAL_WAIT_MS</code> (600000), <code>OFFER_FAVORITES_WINDOW_MS</code> (180000), <code>OFFER_PRO_FREE_DELAY_MS</code> (120000), <code>OFFER_BACKOFF_DELAY_MS</code> (5000).</li>
<li><strong>Pantallas móviles:</strong> <code>screens/offers</code> (CreateOffer, OfferList, OfferDetail, OfferConfirmation), <code>screens/radar</code> (RadarScreen y filtros) y <code>screens/negotiation</code> (Cleaner y bandeja del Host).</li>
<li><strong>Pendiente:</strong> el push depende de credenciales reales de OneSignal y el cobro posterior depende de las claves de Stripe (ver Pagos).</li>
</ul>`,
    },
  ],
});
