/**
 * 43-externos.js — proveedores externos y qué falta para usarlos en producción.
 */
BidCleanArch.registerTab({
  id: 'externos',
  group: 'Plataforma',
  order: 430,
  title: 'Servicios externos',
  summary:
    'Proveedores de terceros que BidClean consume. El código de integración existe para la mayoría, pero faltan credenciales reales de '
    + 'producción. Apple Sign-In está pendiente en Keycloak.',
  diagrams: [
    {
      title: 'Quién llama a quién',
      description: 'App móvil, API y servicio de IA frente a cada proveedor. Línea punteada = integración pendiente.',
      code: `flowchart LR
  APP["App móvil"]
  API["API NestJS"]
  AI["Servicio IA"]
  KC["Keycloak"]
  subgraph PAGOS["Dinero"]
    STRIPE["Stripe Connect<br/>escrow"]
    RC["RevenueCat<br/>suscripciones y ads"]
    ADMOB["AdMob<br/>anuncios"]
  end
  subgraph MENSAJERIA["Comunicación y mapas"]
    OS["OneSignal<br/>push"]
    MAPBOX["Mapbox<br/>mapas"]
  end
  subgraph IDENTIDAD["Login social"]
    GOOGLE["Google OAuth"]
    APPLE["Apple Sign-In"]
  end
  subgraph PLATAFORMA["Plataforma"]
    BEDROCK["AWS Bedrock"]
    SENTRY["Sentry"]
    EASX["Expo EAS"]
  end
  APP --> RC
  APP --> ADMOB
  APP --> MAPBOX
  APP --> SENTRY
  APP -->|login OIDC| KC
  KC --> GOOGLE
  KC -.-> APPLE
  API --> STRIPE
  STRIPE -->|webhooks| API
  RC -->|webhooks| API
  API --> OS
  OS -->|webhooks| API
  API --> SENTRY
  AI -.-> BEDROCK
  EASX -.->|APK y AAB| APP`,
    },
  ],
  nodes: {
    APP: { title: 'App móvil', tipo: 'Cliente', descripcion: 'Usa los SDK de RevenueCat, AdMob, Mapbox y Sentry.', tecnologia: 'React Native + Expo', ubicacion: 'apps/mobile', estado: 'hecho' },
    API: { title: 'API NestJS', tipo: 'Backend', descripcion: 'Llama a Stripe y OneSignal y recibe sus webhooks y los de RevenueCat.', ubicacion: 'services/api', estado: 'hecho' },
    AI: { title: 'Servicio IA', tipo: 'Backend Python', descripcion: 'Previsto como único consumidor de Bedrock.', ubicacion: 'services/ai', estado: 'parcial' },
    KC: { title: 'Keycloak', tipo: 'Identidad', descripcion: 'Intermediario OIDC. Delega el login social a Google y Apple.', tecnologia: 'Keycloak 25.0', ubicacion: 'infra/keycloak', estado: 'hecho' },
    STRIPE: { title: 'Stripe Connect', tipo: 'Proveedor de pagos', descripcion: 'Cobro inmediato, retención en escrow, liberación y reembolso. Multimoneda. Comisión 13%.', tecnologia: 'Stripe API + webhooks', ubicacion: 'services/api/src/payments', consume: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'], adr: 'ADR-005', estado: 'externo', nota: 'Solo hay claves de prueba. Faltan credenciales reales y cuenta Connect.' },
    RC: { title: 'RevenueCat', tipo: 'Proveedor de suscripciones', descripcion: 'Cleaner PRO a 4.99 y Host PRO a 9.99 al mes. Webhooks hacia la API.', tecnologia: 'RevenueCat SDK', ubicacion: 'services/api/src/subscriptions', estado: 'externo', nota: 'Faltan llaves de producción por plataforma.' },
    ADMOB: { title: 'AdMob', tipo: 'Proveedor de anuncios', descripcion: 'Banners para usuarios gratuitos. Sin IDs de unidad usa los de prueba de Google. Proveedor mock para desarrollo.', tecnologia: 'AdMob', ubicacion: 'apps/mobile/src/screens/ads', consume: ['EXPO_PUBLIC_ADMOB_IOS_APP_ID', 'EXPO_PUBLIC_ADMOB_ANDROID_APP_ID'], estado: 'externo', nota: 'Los IDs de aplicación y de banner son marcadores de posición.' },
    OS: { title: 'OneSignal', tipo: 'Proveedor de push', descripcion: 'Envío de notificaciones push y recepción de eventos de entrega por webhook.', tecnologia: 'OneSignal API', ubicacion: 'services/api/src/notifications', estado: 'externo', nota: 'Faltan App ID y REST API key reales.' },
    MAPBOX: { title: 'Mapbox', tipo: 'Proveedor de mapas', descripcion: 'Mapa oscuro personalizado. El build nativo necesita un token secreto de descarga.', tecnologia: 'Mapbox SDK', ubicacion: 'apps/mobile', estado: 'externo', nota: 'Falta el token sk.* MAPBOX_DOWNLOAD_TOKEN en EAS.' },
    GOOGLE: { title: 'Google OAuth', tipo: 'Proveedor de identidad', descripcion: 'Login social con Google a través de Keycloak.', ubicacion: 'infra/keycloak/realm-export.json', estado: 'externo', nota: 'Faltan client id y secret reales.' },
    APPLE: { title: 'Apple Sign-In', tipo: 'Proveedor de identidad', descripcion: 'Requerido por Apple si hay otro login social en iOS. No está configurado como proveedor en Keycloak.', ubicacion: 'infra/keycloak', estado: 'falta', nota: 'Pendiente: configurar el proveedor Apple en Keycloak.' },
    BEDROCK: { title: 'AWS Bedrock', tipo: 'Proveedor de modelos IA', descripcion: 'Único servicio en la nube de la plataforma. Hay variables AWS_* en .env.example, pero services/ai no lo llama todavía.', tecnologia: 'AWS Bedrock', ubicacion: '.env.example', estado: 'externo', nota: 'Sin credenciales reales y sin código de integración.' },
    SENTRY: { title: 'Sentry', tipo: 'Proveedor de errores', descripcion: 'Captura de errores de la app y de la API.', tecnologia: 'Sentry SDK', ubicacion: 'apps/mobile, services/api', estado: 'externo' },
    EASX: { title: 'Expo EAS', tipo: 'Proveedor de builds', descripcion: 'Compila APK y AAB en la nube. Build número 13 generado.', tecnologia: 'EAS Build', ubicacion: 'apps/mobile/eas.json', estado: 'externo' },
  },
  sections: [
    {
      title: 'Credenciales pendientes',
      html: `<ul>
        <li>Stripe: clave secreta, secreto de webhook y cuenta Connect.</li>
        <li>RevenueCat: llaves de iOS y Android y secreto de webhook.</li>
        <li>OneSignal: App ID y REST API key.</li>
        <li>AWS: región, access key y secret para Bedrock.</li>
        <li>Mapbox: token sk.* de descarga.</li>
        <li>AdMob: IDs de aplicación y de banner.</li>
        <li>Apple: proveedor en Keycloak y Services ID.</li></ul>`,
    },
  ],
});
