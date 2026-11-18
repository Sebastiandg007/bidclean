/**
 * 25-suscripciones.js — suscripciones: SubscriptionsModule (NestJS) + RevenueCat, pantalla de paywall y módulo de anuncios del móvil.
 */
BidCleanArch.registerTab({
  id: 'suscripciones',
  group: 'Dominios del negocio',
  order: 250,
  title: 'Suscripciones y anuncios',
  summary:
    'RevenueCat es la fuente de verdad de las compras (Cleaner PRO a $4.99/mes y Host PRO a $9.99/mes). La API mantiene un espejo local de los entitlements '
    + '(<code>cleaner_pro</code>, <code>host_pro</code>, <code>ad_free</code>), alimentado por webhooks firmados con HMAC y un barrido de reconciliación. '
    + 'El nivel FREE o PRO se deriva por rol y alimenta la comisión y los permisos. En el móvil, los usuarios gratis ven anuncios mediante un proveedor abstracto (AdMob o Mock) con consentimiento previo. '
    + '<strong>Pendiente:</strong> faltan las credenciales de producción de RevenueCat y AdMob, por lo que el dominio está en estado parcial.',
  diagrams: [
    {
      title: 'De la compra al entitlement',
      description: 'La compra ocurre en la tienda con el SDK de RevenueCat. El webhook actualiza el espejo en la API y de ahí se deriva el nivel del usuario.',
      code: `flowchart LR
  S_PAYWALL["PaywallScreen<br/>planes PRO"]
  S_USE["useSubscription<br/>entitlements y ProBadge"]
  S_SDK["SDK de RevenueCat<br/>inicia la compra"]
  S_STORE["App Store o Google Play<br/>cobra la suscripción"]
  S_RC["RevenueCat<br/>fuente de verdad"]
  S_HOOK["POST /webhooks/revenuecat<br/>verifica firma HMAC"]
  S_LEDGER[("subscription_events<br/>ledger y outbox")]
  S_QUEUE["Cola de suscripciones<br/>BullMQ"]
  S_PROC["revenuecat-webhook.processor<br/>aplica cambios por entitlement"]
  S_MAPPER["revenuecat-event.mapper<br/>evento a deltas"]
  S_MIRROR[("subscriptions<br/>espejo de entitlements")]
  S_DISPATCH["subscription-dispatch.worker<br/>reencola eventos atascados"]
  S_RECON["SubscriptionReconciliationService<br/>barrido contra RevenueCat"]
  S_CLIENT["revenuecat.client<br/>REST de RevenueCat"]
  S_ME["GET /subscriptions/me<br/>entitlements del usuario"]
  S_TIER["RealSubscriptionTierService<br/>FREE o PRO por rol"]
  S_COMM["CommissionModule<br/>tarifa según nivel"]

  S_PAYWALL --> S_SDK --> S_STORE --> S_RC
  S_RC -->|webhook| S_HOOK --> S_LEDGER
  S_HOOK --> S_QUEUE --> S_PROC
  S_PROC --> S_MAPPER
  S_PROC --> S_MIRROR
  S_DISPATCH -.-> S_QUEUE
  S_DISPATCH -.-> S_LEDGER
  S_RECON --> S_CLIENT --> S_RC
  S_RECON --> S_MIRROR
  S_MIRROR --> S_TIER --> S_COMM
  S_MIRROR --> S_ME --> S_USE --> S_PAYWALL`,
    },
    {
      title: 'Módulo de anuncios del móvil',
      description: 'Anuncios solo para usuarios sin el entitlement ad_free, dentro del radar del Cleaner. Cada fallo se degrada a no mostrar anuncio.',
      code: `flowchart TD
  A_STORE["useAds<br/>store Zustand del ciclo de vida"]
  A_CONSENT["consent<br/>ATT en iOS y UMP"]
  A_PERSON["personalization<br/>modo personalizado o no"]
  A_FACTORY["ad-provider.factory<br/>elige proveedor"]
  A_ADMOB["providers/admob.provider<br/>Google AdMob"]
  A_MOCK["providers/mock.provider<br/>anuncio de prueba"]
  A_VIS["useAdVisibility<br/>elegibilidad según ad_free"]
  A_SLOT["useAdSlot<br/>decide si se dibuja el anuncio"]
  A_BANNER["AdBanner<br/>muestra el anuncio"]
  A_RADAR["AdSlot del radar<br/>lista de ofertas"]
  A_ATTR["ad-attribution<br/>seudónimo del usuario"]
  A_TRACKER["ad-revenue-tracker<br/>deduplica impresiones pagadas"]
  A_RC["RevenueCat AdTracker<br/>ingresos por anuncios"]

  A_CONSENT --> A_PERSON --> A_STORE
  A_STORE --> A_FACTORY
  A_FACTORY -->|producción| A_ADMOB
  A_FACTORY -->|pruebas| A_MOCK
  A_VIS --> A_SLOT
  A_STORE --> A_SLOT
  A_RADAR --> A_SLOT --> A_BANNER
  A_BANNER --> A_ADMOB
  A_BANNER --> A_MOCK
  A_BANNER -->|impresión pagada| A_STORE --> A_TRACKER
  A_ATTR --> A_TRACKER
  A_TRACKER --> A_RC`,
    },
  ],
  nodes: {
    S_PAYWALL: { title: 'PaywallScreen', tipo: 'Pantalla móvil', descripcion: 'Muestra los planes Cleaner PRO ($4.99/mes) y Host PRO ($9.99/mes) y lanza la compra.', tecnologia: 'React Native', ubicacion: 'apps/mobile/src/screens/subscriptions/PaywallScreen.tsx', estado: 'parcial', nota: 'Productos y claves públicas de RevenueCat de producción pendientes.' },
    S_USE: { title: 'useSubscription', tipo: 'Hook móvil', descripcion: 'Lee los entitlements desde GET /subscriptions/me y expone el nivel al resto de la app; ProBadge muestra la insignia PRO.', ubicacion: 'apps/mobile/src/screens/subscriptions/useSubscription.ts', estado: 'hecho' },
    S_SDK: { title: 'SDK de RevenueCat', tipo: 'SDK móvil', descripcion: 'Inicia la compra y la restauración en el dispositivo.', tecnologia: 'react-native-purchases', ubicacion: 'apps/mobile/src/screens/subscriptions/subscriptions.api.ts', estado: 'parcial', nota: 'Requiere las claves públicas de RevenueCat de cada plataforma.' },
    S_STORE: { title: 'App Store y Google Play', tipo: 'Servicio externo', descripcion: 'Las tiendas cobran la suscripción y notifican a RevenueCat.', tecnologia: 'StoreKit y Google Play Billing', estado: 'externo' },
    S_RC: { title: 'RevenueCat', tipo: 'Servicio externo', descripcion: 'Fuente de verdad de compras, renovaciones y entitlements. Envía webhooks firmados a la API.', tecnologia: 'RevenueCat', estado: 'externo', nota: 'Credenciales de producción pendientes: API key y secretos del webhook.' },
    S_HOOK: { title: 'POST /webhooks/revenuecat', tipo: 'Endpoint', descripcion: 'Público. Verifica la firma HMAC-SHA256 con tolerancia de tiempo, sanitiza el evento, lo guarda en el ledger como RECEIVED, lo encola y responde received true.', ubicacion: 'services/api/src/subscriptions/webhooks/revenuecat-webhook.controller.ts', consume: ['evento de RevenueCat'], estado: 'parcial', nota: 'Faltan REVENUECAT_WEBHOOK_SIGNING_SECRET y REVENUECAT_WEBHOOK_AUTH_SECRET de producción.' },
    S_LEDGER: { title: 'subscription_events', tipo: 'Base de datos', descripcion: 'Ledger de eventos de solo agregar, con estados RECEIVED, QUEUED, PROCESSED y FAILED; sirve también de outbox.', tecnologia: 'PostgreSQL + TypeORM', ubicacion: 'services/api/src/subscriptions/entities/subscription-event.entity.ts', estado: 'hecho' },
    S_QUEUE: { title: 'Cola de suscripciones', tipo: 'Cola BullMQ', descripcion: 'Procesa los webhooks de forma asíncrona con reintentos.', tecnologia: 'BullMQ + Redis', ubicacion: 'services/api/src/subscriptions/subscriptions.constants.ts', estado: 'hecho' },
    S_PROC: { title: 'revenuecat-webhook.processor', tipo: 'Worker BullMQ', descripcion: 'Aplica los cambios por entitlement de forma segura ante eventos fuera de orden, marca PROCESSED y deja en FAILED al agotar reintentos.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/subscriptions/webhooks/revenuecat-webhook.processor.ts', consume: ['cola de suscripciones'], estado: 'parcial', nota: 'Probado con eventos simulados; sin RevenueCat de producción.' },
    S_MAPPER: { title: 'revenuecat-event.mapper', tipo: 'Función pura', descripcion: 'Traduce un evento de RevenueCat a deltas de entitlement internos usando el mapa de identificadores.', ubicacion: 'services/api/src/subscriptions/revenuecat/revenuecat-event.mapper.ts', estado: 'hecho' },
    S_MIRROR: { title: 'subscriptions (espejo)', tipo: 'Base de datos', descripcion: 'Una fila por usuario con sus entitlements y vencimientos. Refleja a RevenueCat y nunca concede acceso por sí sola.', tecnologia: 'PostgreSQL + TypeORM', ubicacion: 'services/api/src/subscriptions/entities/subscription.entity.ts', estado: 'hecho' },
    S_DISPATCH: { title: 'subscription-dispatch.worker', tipo: 'Worker programado', descripcion: 'Recupera filas RECEIVED o QUEUED que no se procesaron y las vuelve a encolar.', tecnologia: 'NestJS Schedule', ubicacion: 'services/api/src/subscriptions/webhooks/subscription-dispatch.worker.ts', estado: 'hecho' },
    S_RECON: { title: 'SubscriptionReconciliationService', tipo: 'Servicio programado', descripcion: 'Barrido periódico con @Interval que converge las filas existentes y descubre suscriptores faltantes consultando a RevenueCat.', ubicacion: 'services/api/src/subscriptions/reconciliation/subscription-reconciliation.service.ts', estado: 'parcial', nota: 'Requiere REVENUECAT_API_KEY real.' },
    S_CLIENT: { title: 'revenuecat.client', tipo: 'Cliente externo', descripcion: 'Acceso REST versionado a RevenueCat: getSubscriber y deleteSubscriber.', ubicacion: 'services/api/src/subscriptions/revenuecat/revenuecat.client.ts', estado: 'parcial', nota: 'Sin clave real no se ha probado contra RevenueCat.' },
    S_ME: { title: 'GET /subscriptions/me', tipo: 'Endpoint', descripcion: 'Devuelve los entitlements del usuario autenticado y, si falta o está vencido el espejo, lo repara consultando a RevenueCat.', ubicacion: 'services/api/src/subscriptions/subscriptions.controller.ts', produce: ['entitlements'], estado: 'hecho' },
    S_TIER: { title: 'RealSubscriptionTierService', tipo: 'Servicio NestJS', descripcion: 'Implementa el contrato SUBSCRIPTION_TIER. El nivel se deriva por rol (host_pro para Host, cleaner_pro para Cleaner); ad_free nunca implica PRO. Reemplaza al stub que devolvía FREE.', ubicacion: 'services/api/src/subscriptions/subscription-tier.service.ts', estado: 'hecho' },
    S_COMM: { title: 'CommissionModule', tipo: 'Módulo consumidor', descripcion: 'Consulta el nivel del usuario para resolver la tarifa de comisión aplicable.', ubicacion: 'services/api/src/commission/commission-rates.provider.ts', consume: ['SUBSCRIPTION_TIER'], estado: 'hecho' },

    A_STORE: { title: 'useAds', tipo: 'Store Zustand', descripcion: 'Dueño del ciclo de vida del proveedor, el consentimiento y el reporte de impresiones: initialize, resolveConsent, reportImpression y reset. No decide elegibilidad.', tecnologia: 'Zustand', ubicacion: 'apps/mobile/src/screens/ads/useAds.ts', estado: 'hecho' },
    A_CONSENT: { title: 'consent', tipo: 'Módulo móvil', descripcion: 'Lee el consentimiento del dispositivo: ATT en iOS y UMP. Aislado tras un puente nativo para correr en CI.', ubicacion: 'apps/mobile/src/screens/ads/consent.ts', estado: 'parcial', nota: 'Falta validar el formulario UMP con identificadores de AdMob de producción.' },
    A_PERSON: { title: 'personalization', tipo: 'Función pura', descripcion: 'Deriva el modo de personalización según plataforma y consentimiento. Define la personalización, nunca la elegibilidad.', ubicacion: 'apps/mobile/src/screens/ads/personalization.ts', estado: 'hecho' },
    A_FACTORY: { title: 'ad-provider.factory', tipo: 'Fábrica', descripcion: 'createAdProvider elige AdMobAdProvider o MockAdProvider según configuración; devuelve null si los anuncios están desactivados.', ubicacion: 'apps/mobile/src/screens/ads/ad-provider.factory.ts', estado: 'hecho' },
    A_ADMOB: { title: 'admob.provider', tipo: 'Proveedor de anuncios', descripcion: 'Banner de Google AdMob con ciclo nativo ligado al espacio, colapso ante falta de anuncio y reporte solo de impresiones pagadas.', tecnologia: 'react-native-google-mobile-ads', ubicacion: 'apps/mobile/src/screens/ads/providers/admob.provider.ts', estado: 'parcial', nota: 'Usa ids de prueba de AdMob; faltan los ids de producción.' },
    A_MOCK: { title: 'mock.provider', tipo: 'Proveedor de anuncios', descripcion: 'Proveedor determinista sin SDK nativo para pruebas y CI; nunca se usa como respaldo en producción.', ubicacion: 'apps/mobile/src/screens/ads/providers/mock.provider.ts', estado: 'hecho' },
    A_VIS: { title: 'useAdVisibility', tipo: 'Hook móvil', descripcion: 'Única autoridad de elegibilidad: depende del entitlement ad_free, no del nivel PRO. Vive en la pantalla radar.', ubicacion: 'apps/mobile/src/screens/radar/hooks/useAdVisibility.ts', estado: 'hecho' },
    A_SLOT: { title: 'useAdSlot', tipo: 'Hook móvil', descripcion: 'Decisión por capas: anuncios habilitados, proveedor listo, ubicación permitida y consentimiento resuelto. Conecta la impresión pagada con useAds.', ubicacion: 'apps/mobile/src/screens/ads/useAdSlot.ts', estado: 'hecho' },
    A_BANNER: { title: 'AdBanner', tipo: 'Componente móvil', descripcion: 'Dibuja la vista del proveedor y se colapsa si no hay anuncio o hay error.', ubicacion: 'apps/mobile/src/screens/ads/components/AdBanner.tsx', estado: 'hecho' },
    A_RADAR: { title: 'AdSlot del radar', tipo: 'Componente móvil', descripcion: 'Espacio dentro de la lista de ofertas del radar; el módulo de anuncios solo lo rellena.', ubicacion: 'apps/mobile/src/screens/radar/components/list/AdSlot.tsx', estado: 'hecho' },
    A_ATTR: { title: 'ad-attribution', tipo: 'Función pura', descripcion: 'Genera un seudónimo con SHA-256 y sal a partir del id de usuario, sin exponer el UUID real.', ubicacion: 'apps/mobile/src/screens/ads/ad-attribution.ts', estado: 'hecho' },
    A_TRACKER: { title: 'ad-revenue-tracker', tipo: 'Servicio móvil', descripcion: 'Envía las impresiones pagadas a RevenueCat sin duplicados (memoria y anillo persistido) y sin bloquear ante fallos.', ubicacion: 'apps/mobile/src/screens/ads/ad-revenue-tracker.ts', estado: 'parcial', nota: 'Omite el envío si RevenueCat no está configurado.' },
    A_RC: { title: 'RevenueCat AdTracker', tipo: 'Servicio externo', descripcion: 'Recibe los ingresos por anuncios para unificar el LTV por usuario.', tecnologia: 'RevenueCat', estado: 'externo', nota: 'Requiere claves públicas de producción.' },
  },
  sections: [
    {
      title: 'Endpoints de suscripciones',
      html: `<table>
<thead><tr><th>Método</th><th>Ruta</th><th>Descripción</th></tr></thead>
<tbody>
<tr><td>GET</td><td><code>/subscriptions/me</code></td><td>Entitlements y nivel del usuario autenticado (repara el espejo si falta)</td></tr>
<tr><td>POST</td><td><code>/webhooks/revenuecat</code></td><td>Webhook de RevenueCat con firma HMAC (público, sin JWT)</td></tr>
</tbody></table>`,
    },
    {
      title: 'Planes, entitlements y pendientes',
      html: `<ul>
<li><strong>Planes:</strong> Cleaner PRO $4.99/mes y Host PRO $9.99/mes mediante RevenueCat. Entitlements internos: <code>cleaner_pro</code>, <code>host_pro</code>, <code>ad_free</code>.</li>
<li><strong>Nivel por rol:</strong> un usuario puede ser PRO como Host y FREE como Cleaner. El nivel se calcula al consultar, nunca se guarda como bandera.</li>
<li><strong>Anuncios:</strong> solo en el radar del Cleaner, para usuarios sin <code>ad_free</code>. El consentimiento ajusta la personalización, no la elegibilidad.</li>
<li><strong>Pendiente:</strong> credenciales de producción de RevenueCat (<code>REVENUECAT_API_KEY</code>, secretos del webhook, claves públicas por plataforma) y los ids de producción de AdMob. Mientras tanto el dominio queda en estado parcial.</li>
<li><strong>Specs:</strong> <code>.kiro/specs/revenuecat-subscriptions</code> y <code>.kiro/specs/revenuecat-ads</code>.</li>
</ul>`,
    },
  ],
});
