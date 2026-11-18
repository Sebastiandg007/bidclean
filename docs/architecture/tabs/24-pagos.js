/**
 * 24-pagos.js — pagos: PaymentsModule + CommissionModule (NestJS), Stripe Connect (escrow) y pantallas payments del móvil.
 */
BidCleanArch.registerTab({
  id: 'pagos',
  group: 'Dominios del negocio',
  order: 240,
  title: 'Pagos, escrow y comisión',
  summary:
    'Al emitirse <code>offer.matched</code>, la API cobra de inmediato al Host con un PaymentIntent de Stripe y retiene los fondos en la cuenta de la plataforma (escrow). '
    + 'Los fondos se liberan al Cleaner con un Transfer cuando el servicio se confirma, tras la liberación automática (24 h por defecto) o al resolverse una disputa. '
    + 'La comisión total es del <strong>13 %</strong>: 10 % a cargo del Host y 3 % a cargo del Cleaner. Todos los montos son enteros en centavos. '
    + '<strong>Pendiente:</strong> faltan las claves reales de Stripe, por lo que los servicios de pago están en estado parcial. Decisión en ADR-005.',
  diagrams: [
    {
      title: 'Flujo del dinero (escrow)',
      description: 'Desde el acuerdo de precio hasta el pago al Cleaner. El Host paga el precio más 10 %; el Cleaner recibe el precio menos 3 %; la plataforma conserva el 13 %.',
      code: `flowchart TD
  M_MATCHED["offer.matched<br/>precio acordado"]
  M_LISTENER["OfferMatchedListener<br/>escucha el evento"]
  M_COMM["CommissionService<br/>desglose en centavos: 10 % Host + 3 % Cleaner"]
  M_CHARGE["EscrowChargeService<br/>PaymentIntent con clave idempotente"]
  M_STRIPE["Stripe Connect<br/>cobra la tarjeta del Host"]
  M_HELD[("Cuenta de la plataforma<br/>fondos retenidos en HELD")]
  M_CONFIRM["Servicio confirmado<br/>por el Host"]
  M_AUTO["AutoReleaseWorker<br/>libera tras 24 h sin disputa"]
  M_DISPUTE{"¿Hay disputa abierta?"}
  M_ACCT{"¿Cuenta del Cleaner habilitada?"}
  M_DEFER["Pago diferido<br/>cola payments-deferred-release"]
  M_RELEASE["EscrowReleaseService<br/>Transfer único al Cleaner"]
  M_CLEANER["Cleaner recibe<br/>precio menos 3 %"]
  M_PLATFORM["Plataforma retiene 13 %<br/>10 % Host + 3 % Cleaner"]
  M_REFUND["RefundService<br/>reembolso o reversión del Transfer"]

  M_MATCHED --> M_LISTENER --> M_COMM --> M_CHARGE --> M_STRIPE --> M_HELD
  M_HELD --> M_CONFIRM --> M_DISPUTE
  M_HELD --> M_AUTO --> M_DISPUTE
  M_DISPUTE -->|sí, se pausa| M_REFUND
  M_DISPUTE -->|no| M_ACCT
  M_ACCT -->|no| M_DEFER -->|cuenta habilitada| M_RELEASE
  M_ACCT -->|sí| M_RELEASE
  M_RELEASE --> M_CLEANER
  M_RELEASE --> M_PLATFORM
  M_HELD -->|Host pide reembolso| M_REFUND`,
    },
    {
      title: 'Arquitectura de PaymentsModule y CommissionModule',
      description: 'Pantallas, controladores, webhooks de Stripe, reconciliación y reglas de comisión. El webhook responde rápido y procesa en una cola.',
      code: `flowchart TB
  subgraph MOVIL["App móvil"]
    P_HOSTSCR["HostPaymentMethodScreen<br/>método de pago del Host"]
    P_CLEANERSCR["CleanerPayoutOnboardingScreen<br/>alta de cobros"]
    P_STATUSSCR["PaymentStatusScreen<br/>estado, disputa y reembolso"]
  end
  subgraph PAGOS["PaymentsModule NestJS"]
    P_CTRL["PaymentsController<br/>/payments/*"]
    P_WHCTRL["StripeWebhookController<br/>valida firma y deduplica"]
    P_WHQ["Cola payments-stripe-webhook"]
    P_WHPROC["stripe-webhook.processor<br/>aplica el evento de Stripe"]
    P_CONNECT["ConnectOnboardingService<br/>cuentas Express de Cleaners"]
    P_CONNREC["ConnectReconciliationService<br/>barrido cada 15 min"]
    P_PAYREC["PaymentReconciliationService<br/>barrido de pagos en PROCESSING"]
    P_DISPUTE["DisputeService<br/>disputas de Stripe"]
    P_REFUND["RefundService<br/>política de reembolso"]
    P_SM["payment-state-machine<br/>pago, disputa y payout"]
    P_REPO["PaymentsRepository<br/>bloqueo FOR UPDATE"]
    P_CLIENT["stripe.client<br/>único acceso al SDK"]
  end
  subgraph COMISION["CommissionModule NestJS"]
    C_RESOLVER["rate-resolver.service<br/>elige la tarifa por regla"]
    C_ADMIN["CommissionAdminController<br/>/admin/commission/rules"]
  end
  subgraph EXTERNO["Servicios externos"]
    P_STRIPE["Stripe Connect<br/>PaymentIntents y Transfers"]
    P_PG[("PostgreSQL<br/>payments, payment_events, stripe_accounts")]
  end
  P_HOSTSCR --> P_CTRL
  P_CLEANERSCR --> P_CTRL
  P_STATUSSCR --> P_CTRL
  P_CTRL --> P_CONNECT
  P_CTRL --> P_REFUND
  P_CONNECT --> P_CLIENT
  P_REFUND --> P_CLIENT
  P_CLIENT --> P_STRIPE
  P_STRIPE -->|webhooks| P_WHCTRL --> P_WHQ --> P_WHPROC
  P_WHPROC --> P_DISPUTE
  P_WHPROC --> P_REPO
  P_DISPUTE --> P_REPO
  P_REFUND --> P_REPO
  P_REPO --> P_SM
  P_REPO --> P_PG
  P_CONNREC --> P_CLIENT
  P_PAYREC --> P_CLIENT
  P_CONNREC --> P_REPO
  P_PAYREC --> P_REPO
  C_ADMIN --> C_RESOLVER
  C_RESOLVER -->|tarifa Host y Cleaner| P_CTRL`,
    },
  ],
  nodes: {
    M_MATCHED: { title: 'offer.matched', tipo: 'Evento de dominio', descripcion: 'Lo emite OffersModule cuando hay Cleaner asignado y precio acordado.', tecnologia: 'EventEmitter2', ubicacion: 'services/api/src/offers/events/offer-domain-events.ts', produce: ['offerId', 'precio acordado'], estado: 'hecho' },
    M_LISTENER: { title: 'OfferMatchedListener', tipo: 'Listener NestJS', descripcion: 'Se suscribe a offer.matched con @OnEvent y dispara el cobro en escrow.', tecnologia: 'NestJS EventEmitter', ubicacion: 'services/api/src/payments/listeners/offer-matched.listener.ts', consume: ['offer.matched'], estado: 'parcial', nota: 'Funciona en pruebas; sin claves reales de Stripe no completa el cobro.' },
    M_COMM: { title: 'CommissionService', tipo: 'Servicio NestJS', descripcion: 'Aritmética pura en centavos del desglose: 10 % a cargo del Host y 3 % a cargo del Cleaner. Las tarifas por defecto vienen de OFFER_HOST_FEE_RATE_BPS y OFFER_CLEANER_RATE_BPS y las resuelve CommissionModule.', ubicacion: 'services/api/src/offers/commission/commission.service.ts', consume: ['tarifas resueltas'], produce: ['desglose en centavos'], estado: 'hecho' },
    M_CHARGE: { title: 'EscrowChargeService', tipo: 'Servicio NestJS', descripcion: 'Calcula el desglose, crea el pago (PENDING) y un intento de cobro, y crea el PaymentIntent con clave idempotente charge:offerId:n. Al confirmarse guarda la comisión de Stripe y emite payment.captured.', ubicacion: 'services/api/src/payments/escrow/escrow-charge.service.ts', adr: 'ADR-005', consume: ['offer.matched'], produce: ['payment.captured'], estado: 'parcial', nota: 'Falta la clave secreta real de Stripe; no se ha ejecutado contra la cuenta real.' },
    M_STRIPE: { title: 'Stripe Connect', tipo: 'Servicio externo', descripcion: 'Procesa el cobro a la tarjeta del Host, mantiene cuentas Express para los Cleaners y ejecuta Transfers y reembolsos. Cumple PCI: BidClean nunca toca datos de tarjeta.', tecnologia: 'Stripe Connect', adr: 'ADR-005', estado: 'externo', nota: 'Claves reales pendientes (STRIPE_SECRET_KEY y STRIPE_WEBHOOK_SECRET).' },
    M_HELD: { title: 'Fondos retenidos (HELD)', tipo: 'Estado del pago', descripcion: 'El dinero queda en la cuenta de la plataforma hasta la liberación. Ciclo del pago: PENDING, PROCESSING, HELD y luego RELEASED, REFUNDED o PARTIALLY_REFUNDED.', ubicacion: 'services/api/src/payments/payment-state-machine.ts', adr: 'ADR-005', estado: 'hecho' },
    M_CONFIRM: { title: 'Servicio confirmado', tipo: 'Disparador', descripcion: 'La confirmación del Host al terminar el servicio dispara la liberación desde el flujo de finalización del servicio. No es una acción REST pública de pagos.', estado: 'hecho' },
    M_AUTO: { title: 'AutoReleaseWorker', tipo: 'Worker programado', descripcion: 'Barrido con @Interval (PAYMENTS_AUTO_RELEASE_SWEEP_MS, 300000 ms) que libera pagos HELD tras ESCROW_AUTO_RELEASE_HOURS (24 por defecto).', tecnologia: 'NestJS Schedule', ubicacion: 'services/api/src/payments/release/auto-release.worker.ts', estado: 'parcial', nota: 'Probado con simulación; la liberación real requiere Stripe configurado.' },
    M_DISPUTE: { title: '¿Hay disputa abierta?', tipo: 'Decisión', descripcion: 'Mientras dispute_status sea OPEN no se libera dinero ni se permite reembolsar (regla P5).', estado: 'hecho' },
    M_ACCT: { title: '¿Cuenta del Cleaner habilitada?', tipo: 'Decisión', descripcion: 'Si la cuenta Express no tiene payouts habilitados, el pago se difiere hasta que complete el alta (regla P6).', estado: 'hecho' },
    M_DEFER: { title: 'Pago diferido', tipo: 'Cola BullMQ', descripcion: 'Cola payments-deferred-release. releaseDeferredForCleaner libera los pagos pendientes cuando el Cleaner pasa a ser elegible.', tecnologia: 'BullMQ + Redis', ubicacion: 'services/api/src/payments/payments.constants.ts', estado: 'hecho' },
    M_RELEASE: { title: 'EscrowReleaseService', tipo: 'Servicio NestJS', descripcion: 'Crea un único Transfer al Cleaner con clave idempotente release:paymentId, nunca libera con disputa abierta y emite payment.released.', ubicacion: 'services/api/src/payments/escrow/escrow-release.service.ts', adr: 'ADR-005', produce: ['payment.released'], estado: 'parcial', nota: 'Falta Stripe real para ejecutar el Transfer.' },
    M_CLEANER: { title: 'Pago al Cleaner', tipo: 'Resultado', descripcion: 'El Cleaner recibe el precio acordado menos su comisión del 3 %.', estado: 'hecho' },
    M_PLATFORM: { title: 'Ingreso de la plataforma', tipo: 'Resultado', descripcion: 'BidClean conserva el 13 % (10 % del Host más 3 % del Cleaner), descontando la comisión de procesamiento de Stripe.', estado: 'hecho' },
    M_REFUND: { title: 'RefundService', tipo: 'Servicio NestJS', descripcion: 'Autoriza al Host dueño, aplica refund-policy y hace un Refund antes de liberar o una reversión del Transfer más Refund después. Bloquea con disputa abierta (409) y respeta los topes (422).', ubicacion: 'services/api/src/payments/refunds/refund.service.ts', produce: ['payment.refunded'], estado: 'parcial', nota: 'Falta Stripe real para ejecutar reembolsos.' },

    P_HOSTSCR: { title: 'HostPaymentMethodScreen', tipo: 'Pantalla móvil', descripcion: 'El Host registra y revisa su método de pago.', ubicacion: 'apps/mobile/src/screens/payments/HostPaymentMethodScreen.tsx', estado: 'parcial', nota: 'Requiere la clave pública de Stripe real para tokenizar tarjetas.' },
    P_CLEANERSCR: { title: 'CleanerPayoutOnboardingScreen', tipo: 'Pantalla móvil', descripcion: 'El Cleaner inicia el alta de cobros de Stripe Connect; usa PayoutOnboardingBanner para recordarlo.', ubicacion: 'apps/mobile/src/screens/payments/CleanerPayoutOnboardingScreen.tsx', estado: 'parcial', nota: 'El Account Link solo funciona con Stripe real.' },
    P_STATUSSCR: { title: 'PaymentStatusScreen', tipo: 'Pantalla móvil', descripcion: 'Muestra el estado del pago, la disputa (DisputeBanner) y permite solicitar reembolsos (RefundSheet). Usa usePayments y payments.status-map.', ubicacion: 'apps/mobile/src/screens/payments/PaymentStatusScreen.tsx', estado: 'hecho' },
    P_CTRL: { title: 'PaymentsController', tipo: 'Controlador NestJS', descripcion: 'Endpoints /payments/connect/onboarding, /payments/connect/status, /payments/offers/:offerId y /payments/offers/:offerId/refund. Protegidos con JWT.', ubicacion: 'services/api/src/payments/payments.controller.ts', estado: 'hecho' },
    P_WHCTRL: { title: 'StripeWebhookController', tipo: 'Controlador NestJS', descripcion: 'POST /payments/webhooks/stripe, público y sin JWT. Verifica la firma sobre el cuerpo crudo, deduplica por id de evento, guarda el evento sanitizado y responde 2xx rápido.', ubicacion: 'services/api/src/payments/webhooks/stripe-webhook.controller.ts', estado: 'parcial', nota: 'Falta STRIPE_WEBHOOK_SECRET real.' },
    P_WHQ: { title: 'Cola payments-stripe-webhook', tipo: 'Cola BullMQ', descripcion: 'Desacopla la recepción del webhook de su procesamiento, con reintentos y backoff.', tecnologia: 'BullMQ + Redis', ubicacion: 'services/api/src/payments/payments.constants.ts', estado: 'hecho' },
    P_WHPROC: { title: 'stripe-webhook.processor', tipo: 'Worker BullMQ', descripcion: 'Despacha por tipo de evento: payment_intent, account.updated, charge.dispute.* y reembolsos, y converge el estado local.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/payments/webhooks/stripe-webhook.processor.ts', consume: ['payments-stripe-webhook'], estado: 'parcial', nota: 'Probado con eventos simulados.' },
    P_CONNECT: { title: 'ConnectOnboardingService', tipo: 'Servicio NestJS', descripcion: 'Crea o reutiliza una cuenta Express por Cleaner, genera el Account Link y sincroniza capacidades.', ubicacion: 'services/api/src/payments/connect/connect-onboarding.service.ts', estado: 'parcial', nota: 'Requiere Stripe real.' },
    P_CONNREC: { title: 'ConnectReconciliationService', tipo: 'Servicio programado', descripcion: 'Cada CONNECT_RECONCILE_INTERVAL_MS (900000 ms) repara el estado de las cuentas no habilitadas y dispara pagos diferidos.', ubicacion: 'services/api/src/payments/connect/connect-reconciliation.service.ts', estado: 'hecho' },
    P_PAYREC: { title: 'PaymentReconciliationService', tipo: 'Servicio programado', descripcion: 'Respaldo de los webhooks: revisa pagos atascados en PROCESSING y los converge con la verdad de Stripe (PAYMENTS_RECONCILE_INTERVAL_MS, 600000 ms).', ubicacion: 'services/api/src/payments/reconciliation/payment-reconciliation.service.ts', estado: 'hecho' },
    P_DISPUTE: { title: 'DisputeService', tipo: 'Servicio NestJS', descripcion: 'Abre y cierra disputas desde los eventos charge.dispute.* de Stripe (OPEN, WON, LOST) y emite payment.disputed. dispute-settlement.service.ts liquida las disputas perdidas.', ubicacion: 'services/api/src/payments/disputes/dispute.service.ts', estado: 'hecho' },
    P_REFUND: { title: 'RefundService', tipo: 'Servicio NestJS', descripcion: 'Aplica la política de reembolso sobre el pago actual.', ubicacion: 'services/api/src/payments/refunds/refund.service.ts', estado: 'parcial', nota: 'Requiere Stripe real.' },
    P_SM: { title: 'payment-state-machine', tipo: 'Máquina de estados', descripcion: 'Tres ciclos ortogonales y puros: pago, disputa y payout. Devuelve valid o no; el servicio decide si lanzar el error.', ubicacion: 'services/api/src/payments/payment-state-machine.ts', estado: 'hecho' },
    P_REPO: { title: 'PaymentsRepository', tipo: 'Repositorio', descripcion: 'Única capa de acceso a datos del módulo. Muta bajo SELECT FOR UPDATE, valida cada estado y deduplica eventos de Stripe.', ubicacion: 'services/api/src/payments/payments.repository.ts', estado: 'hecho' },
    P_CLIENT: { title: 'stripe.client', tipo: 'Cliente externo', descripcion: 'Envoltorio del SDK de Stripe. Toda llamada que muta envía clave de idempotencia.', ubicacion: 'services/api/src/payments/stripe/stripe.client.ts', estado: 'parcial', nota: 'Sin claves reales no se ha probado contra Stripe.' },
    P_STRIPE: { title: 'Stripe Connect', tipo: 'Servicio externo', descripcion: 'PaymentIntents, Transfers, Refunds y cuentas Express.', tecnologia: 'Stripe Connect', adr: 'ADR-005', estado: 'externo', nota: 'Claves reales pendientes.' },
    P_PG: { title: 'PostgreSQL (pagos)', tipo: 'Base de datos', descripcion: 'Tablas payments, payment_attempts, payment_events y stripe_accounts. Todo en enteros de centavos.', tecnologia: 'PostgreSQL + TypeORM', ubicacion: 'services/api/src/payments/entities', estado: 'hecho' },
    C_RESOLVER: { title: 'rate-resolver.service', tipo: 'Servicio NestJS', descripcion: 'Elige la tarifa del Host (al crear la oferta) y la del Cleaner (al hacer match) a partir de reglas versionadas con alcance y prioridad. Sin regla aplicable usa la tarifa por defecto del entorno.', ubicacion: 'services/api/src/commission/rate-resolver.service.ts', estado: 'hecho' },
    C_ADMIN: { title: 'CommissionAdminController', tipo: 'Controlador NestJS', descripcion: 'CRUD operativo de reglas en /admin/commission/rules con JWT, lista de administradores y límite de tasa. Cada cambio queda en una auditoría.', ubicacion: 'services/api/src/commission/admin/commission-admin.controller.ts', estado: 'hecho' },
  },
  sections: [
    {
      title: 'Endpoints de pagos y comisión',
      html: `<table>
<thead><tr><th>Método</th><th>Ruta</th><th>Descripción</th></tr></thead>
<tbody>
<tr><td>POST</td><td><code>/payments/connect/onboarding</code></td><td>Crea el Account Link para que el Cleaner complete el alta en Stripe</td></tr>
<tr><td>GET</td><td><code>/payments/connect/status</code></td><td>Estado de la cuenta de cobros del Cleaner</td></tr>
<tr><td>GET</td><td><code>/payments/offers/:offerId</code></td><td>Estado del pago de una oferta</td></tr>
<tr><td>POST</td><td><code>/payments/offers/:offerId/refund</code></td><td>Reembolso total o parcial solicitado por el Host</td></tr>
<tr><td>POST</td><td><code>/payments/webhooks/stripe</code></td><td>Webhook de Stripe (firma, sin JWT)</td></tr>
<tr><td>GET</td><td><code>/admin/commission/rules</code></td><td>Lista reglas de comisión</td></tr>
<tr><td>POST</td><td><code>/admin/commission/rules</code></td><td>Crea una regla de comisión</td></tr>
<tr><td>PATCH</td><td><code>/admin/commission/rules/:id</code></td><td>Edita una regla</td></tr>
<tr><td>POST</td><td><code>/admin/commission/rules/:id/activate</code></td><td>Activa una regla</td></tr>
<tr><td>POST</td><td><code>/admin/commission/rules/:id/deactivate</code></td><td>Desactiva una regla</td></tr>
<tr><td>GET</td><td><code>/admin/commission/rules/:id/audit</code></td><td>Historial de auditoría de una regla</td></tr>
</tbody></table>`,
    },
    {
      title: 'Comisión, eventos y estado',
      html: `<ul>
<li><strong>Comisión 13 %:</strong> 10 % del Host más 3 % del Cleaner. Cada lado se resuelve en un momento distinto: el del Host al crear la oferta y el del Cleaner al hacer match.</li>
<li><strong>Eventos de dominio:</strong> <code>payment.captured</code>, <code>payment.released</code>, <code>payment.failed</code>, <code>payment.refunded</code>, <code>payment.disputed</code>.</li>
<li><strong>Variables de entorno:</strong> <code>ESCROW_AUTO_RELEASE_HOURS</code>, <code>PAYMENTS_AUTO_RELEASE_SWEEP_MS</code>, <code>PAYMENTS_RECONCILE_INTERVAL_MS</code>, <code>CONNECT_RECONCILE_INTERVAL_MS</code>, <code>PAYMENTS_BACKOFF_DELAY_MS</code> y las claves de Stripe.</li>
<li><strong>Pendiente:</strong> las claves reales de Stripe no están configuradas. Los servicios de pago están completos y probados con simulaciones, pero no ejecutados contra Stripe.</li>
<li><strong>Decisión:</strong> ADR-005 (<code>docs/ADR/005-stripe-connect-escrow.md</code>).</li>
</ul>`,
    },
  ],
});
