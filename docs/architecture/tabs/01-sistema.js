/**
 * 01-sistema.js — arquitectura completa: todos los componentes y cómo se conectan.
 */
BidCleanArch.registerTab({
  id: 'sistema',
  group: 'Visión general',
  order: 10,
  title: 'Sistema completo',
  summary:
    'Todos los componentes de BidClean: app móvil, API NestJS con sus 19 módulos, microservicio de IA, infraestructura self-hosted '
    + 'y servicios externos. Cada flecha es una integración real del código. Pasa el mouse sobre un componente para ver su detalle.',
  diagrams: [
    {
      title: 'Arquitectura del sistema',
      description: 'Vista de alto nivel por capas: cliente → borde → backend → datos/infra → servicios externos.',
      code: `flowchart TB
  subgraph CLIENTE["Cliente"]
    APP["App móvil<br/>React Native + Expo"]
    STORES["Stores Zustand"]
    APP --- STORES
  end
  subgraph BORDE["Borde"]
    TRAEFIK["Traefik<br/>(SSL Let's Encrypt)"]
  end
  subgraph BACKEND["Backend"]
    API["API NestJS<br/>api.bidclean.tech"]
    WORKERS["Workers BullMQ<br/>(16 colas)"]
    OUTBOX["Outbox transaccional<br/>(eventos de dominio)"]
    AI["Microservicio IA<br/>FastAPI"]
    API --- OUTBOX
    OUTBOX --> WORKERS
  end
  subgraph DATOS["Datos e infraestructura self-hosted"]
    PG[("PostgreSQL 16<br/>+ PostGIS")]
    REDIS[("Redis 7")]
    MINIO[("MinIO<br/>almacenamiento S3")]
    KC["Keycloak 25<br/>OAuth2 / OIDC"]
    CENT["Centrifugo v5<br/>WebSocket"]
    LIVEKIT["LiveKit<br/>VoIP / video"]
    LT["LibreTranslate"]
    WHISPER["Whisper.cpp<br/>voz → texto"]
    PIPER["Piper<br/>texto → voz"]
    MON["Prometheus + Grafana<br/>+ Loki"]
  end
  subgraph EXTERNOS["Servicios externos"]
    STRIPE["Stripe Connect<br/>escrow"]
    RC["RevenueCat<br/>suscripciones y ads"]
    OS["OneSignal<br/>push"]
    BEDROCK["AWS Bedrock<br/>modelos IA"]
    MAPBOX["Mapbox<br/>mapas"]
    SENTRY["Sentry<br/>errores"]
    EASX["Expo EAS<br/>builds"]
  end
  APP -->|HTTPS REST| TRAEFIK --> API
  APP -->|WebSocket| CENT
  APP -->|login OIDC + PKCE| KC
  APP -->|WebRTC| LIVEKIT
  APP --> MAPBOX
  APP --> RC
  APP --> SENTRY
  EASX -.->|APK / AAB| APP
  API --> PG
  API --> REDIS
  WORKERS --> REDIS
  WORKERS --> PG
  API -->|valida JWT| KC
  API -->|publica| CENT
  API -->|archivos firmados| MINIO
  API -->|tokens de sala| LIVEKIT
  API --> LT
  API -->|HTTP interno| AI
  WORKERS --> STRIPE
  STRIPE -->|webhooks| API
  RC -->|webhooks| API
  WORKERS --> OS
  AI --> WHISPER
  AI --> PIPER
  AI --> BEDROCK
  AI --> MINIO
  API --> SENTRY
  MON -.->|métricas y logs| API`,
    },
    {
      title: 'Módulos de la API NestJS',
      description: '<code>AppModule</code> importa ConfigModule, TypeOrmModule, BullModule y 19 módulos de negocio.',
      code: `flowchart LR
  APPMOD["AppModule"]
  subgraph IDENTIDAD["Identidad"]
    M_HEALTH["HealthModule"]
    M_AUTH["AuthModule"]
    M_ROLES["RolesModule"]
    M_KYC["KycModule"]
    M_PROFILE["ProfileModule"]
  end
  subgraph MERCADO["Mercado"]
    M_PROP["PropertiesModule"]
    M_OFFERS["OffersModule"]
    M_NEGO["NegotiationModule"]
    M_FAV["FavoritesModule"]
  end
  subgraph DINERO["Dinero"]
    M_PAY["PaymentsModule"]
    M_SUBS["SubscriptionsModule"]
    M_COMM["CommissionModule"]
  end
  subgraph COMUNICACION["Comunicación"]
    M_CHAT["ChatModule<br/>(chat, notas de voz, VoIP)"]
    M_NOTIF["NotificationsModule"]
  end
  subgraph SERVICIO["Ejecución del servicio"]
    M_TRACK["ServiceTrackingModule"]
    M_VIDEO["VideoVerificationModule"]
    M_CHECK["ChecklistPhotosModule"]
    M_COMP["ServiceCompletionModule"]
    M_DISP["DisputeSystemModule"]
  end
  APPMOD --> IDENTIDAD
  APPMOD --> MERCADO
  APPMOD --> DINERO
  APPMOD --> COMUNICACION
  APPMOD --> SERVICIO`,
    },
  ],
  nodes: {
    APP: { title: 'App móvil', tipo: 'Frontend', descripcion: 'Una sola base de código para iOS, Android y Samsung Galaxy. Expo Router, Reanimated 3, i18n en 7 idiomas.', tecnologia: 'React Native + Expo SDK', ubicacion: 'apps/mobile', adr: 'ADR-001', estado: 'hecho' },
    STORES: { title: 'Stores Zustand', tipo: 'Estado del cliente', descripcion: 'Un store por dominio: auth.store, role.store y stores por pantalla (chat, ofertas, tema…).', tecnologia: 'Zustand', ubicacion: 'apps/mobile/src/stores, src/screens/*/', estado: 'hecho' },
    TRAEFIK: { title: 'Traefik', tipo: 'Reverse proxy', descripcion: 'Entrada HTTPS con certificados automáticos de Let\'s Encrypt. Aún no está en docker-compose.', tecnologia: 'Traefik', ubicacion: 'infra/ (pendiente)', estado: 'falta' },
    API: { title: 'API NestJS', tipo: 'Backend', descripcion: 'API REST con 19 módulos de negocio. Valida JWT de Keycloak, escribe en PostgreSQL y emite eventos por outbox.', tecnologia: 'NestJS + TypeORM', ubicacion: 'services/api', consume: ['PostgreSQL', 'Redis', 'Keycloak'], produce: ['Eventos outbox', 'Publicaciones Centrifugo'], adr: 'ADR-003', estado: 'hecho' },
    WORKERS: { title: 'Workers BullMQ', tipo: 'Procesamiento asíncrono', descripcion: '16 colas: expansión de radio, entrega por niveles, webhooks de Stripe/RevenueCat, notificaciones, transcripción, liberación de pagos, disputas…', tecnologia: 'BullMQ + Redis', ubicacion: 'services/api/src/*/ (archivos *.worker.ts, *.processor.ts)', estado: 'hecho' },
    OUTBOX: { title: 'Outbox transaccional', tipo: 'Patrón de eventos', descripcion: 'Los eventos se guardan en la misma transacción que el cambio de datos y luego se despachan. Evita perder eventos.', tecnologia: 'PostgreSQL + OutboxWriter', ubicacion: 'packages/shared/src/outbox', produce: ['offer.matched', 'service_started', 'checklist_completed', 'service_confirmed', 'payment.released'], estado: 'hecho' },
    AI: { title: 'Microservicio IA', tipo: 'Backend Python', descripcion: 'OCR de documentos, comparación facial, prueba de vida, transcripción y verificación facial.', tecnologia: 'FastAPI', ubicacion: 'services/ai', produce: ['/ai/ocr', '/ai/face-compare', '/ai/liveness', '/transcribe', '/verify-face'], estado: 'parcial', nota: 'No está en docker-compose; Whisper aún no conectado.' },
    PG: { title: 'PostgreSQL + PostGIS', tipo: 'Base de datos', descripcion: 'Datos de negocio y consultas geoespaciales (radio de búsqueda de ofertas).', tecnologia: 'postgis/postgis:16-3.4', ubicacion: 'infra/docker-compose.yml (puerto 15432)', estado: 'hecho' },
    REDIS: { title: 'Redis', tipo: 'Cache y colas', descripcion: 'Backend de BullMQ y cache.', tecnologia: 'Redis 7', ubicacion: 'infra/docker-compose.yml (puerto 16379)', estado: 'hecho' },
    MINIO: { title: 'MinIO', tipo: 'Almacenamiento de objetos', descripcion: 'Fotos de checklist, documentos KYC, notas de voz, videos. URLs firmadas.', tecnologia: 'MinIO (S3 compatible)', ubicacion: 'infra/docker-compose.yml (9000/9001)', estado: 'hecho' },
    KC: { title: 'Keycloak', tipo: 'Identidad', descripcion: 'Registro, login, OAuth social (Google/Apple) y emisión de JWT.', tecnologia: 'Keycloak 25', ubicacion: 'infra/keycloak, puerto 8080', adr: 'ADR-004', estado: 'hecho' },
    CENT: { title: 'Centrifugo', tipo: 'Tiempo real', descripcion: 'WebSocket para radar de ofertas, chat, seguimiento GPS y estados del servicio.', tecnologia: 'Centrifugo v5', ubicacion: 'infra/centrifugo, puerto 8001', estado: 'hecho' },
    LIVEKIT: { title: 'LiveKit', tipo: 'VoIP / video', descripcion: 'Llamadas de voz y verificación por video entre Host y Cleaner.', tecnologia: 'LiveKit self-hosted', ubicacion: 'rtc.bidclean.tech (pendiente de desplegar)', estado: 'falta' },
    LT: { title: 'LibreTranslate', tipo: 'Traducción', descripcion: 'Traducción automática de mensajes del chat entre idiomas.', tecnologia: 'LibreTranslate', ubicacion: 'infra/docker-compose.yml (puerto 5000)', estado: 'hecho' },
    WHISPER: { title: 'Whisper.cpp', tipo: 'Voz a texto', descripcion: 'Transcripción de notas de voz en CPU.', tecnologia: 'Whisper.cpp', ubicacion: 'pendiente de desplegar', estado: 'falta' },
    PIPER: { title: 'Piper', tipo: 'Texto a voz', descripcion: 'Síntesis de voz en CPU.', tecnologia: 'Piper', ubicacion: 'pendiente de desplegar', estado: 'falta' },
    MON: { title: 'Monitoreo', tipo: 'Observabilidad', descripcion: 'Métricas, tableros y logs centralizados.', tecnologia: 'Prometheus + Grafana + Loki', ubicacion: 'pendiente de desplegar', estado: 'falta' },
    STRIPE: { title: 'Stripe Connect', tipo: 'Pagos', descripcion: 'Cobro inmediato, retención en escrow y liberación al confirmar. Multimoneda.', tecnologia: 'Stripe API + webhooks', ubicacion: 'services/api/src/payments', adr: 'ADR-005', estado: 'parcial', nota: 'Faltan credenciales reales.' },
    RC: { title: 'RevenueCat', tipo: 'Suscripciones y anuncios', descripcion: 'Cleaner PRO y Host PRO; anuncios para usuarios gratuitos.', tecnologia: 'RevenueCat SDK + webhooks', ubicacion: 'services/api/src/subscriptions, apps/mobile/src/screens/ads', estado: 'parcial', nota: 'Faltan credenciales de producción.' },
    OS: { title: 'OneSignal', tipo: 'Push', descripcion: 'Notificaciones push a iOS y Android.', tecnologia: 'OneSignal API', ubicacion: 'services/api/src/notifications', estado: 'parcial', nota: 'Faltan credenciales reales.' },
    BEDROCK: { title: 'AWS Bedrock', tipo: 'Modelos IA', descripcion: 'Único servicio cloud: modelos para análisis de documentos y apoyo al KYC.', tecnologia: 'AWS Bedrock', ubicacion: 'services/ai', estado: 'parcial', nota: 'Faltan credenciales AWS.' },
    MAPBOX: { title: 'Mapbox', tipo: 'Mapas', descripcion: 'Mapa oscuro personalizado para radar y seguimiento.', tecnologia: '@rnmapbox/maps', ubicacion: 'apps/mobile', estado: 'externo' },
    SENTRY: { title: 'Sentry', tipo: 'Errores', descripcion: 'Captura de errores de la app y de la API.', tecnologia: 'Sentry SDK', ubicacion: 'apps/mobile, services/api', estado: 'externo' },
    EASX: { title: 'Expo EAS', tipo: 'Build móvil', descripcion: 'Compila el APK/AAB en la nube. Build #13 generado.', tecnologia: 'EAS Build', ubicacion: 'apps/mobile/eas.json', estado: 'externo' },
    APPMOD: { title: 'AppModule', tipo: 'Módulo raíz', descripcion: 'Importa ConfigModule, TypeOrmModule, BullModule.forRootAsync(REDIS_URL) y los 19 módulos de negocio.', ubicacion: 'services/api/src/app.module.ts', estado: 'hecho' },
    M_HEALTH: { title: 'HealthModule', tipo: 'Módulo NestJS', descripcion: 'Endpoints de salud para orquestación y monitoreo.', ubicacion: 'services/api/src/health', estado: 'hecho' },
    M_AUTH: { title: 'AuthModule', tipo: 'Módulo NestJS', descripcion: 'Registro, login, sesiones, verificación de email, biometría y OAuth vía Keycloak.', ubicacion: 'services/api/src/auth', estado: 'hecho' },
    M_ROLES: { title: 'RolesModule', tipo: 'Módulo NestJS', descripcion: 'Roles Host / Cleaner y cambio de rol.', ubicacion: 'services/api/src/roles', estado: 'hecho' },
    M_KYC: { title: 'KycModule', tipo: 'Módulo NestJS', descripcion: 'Verificación de identidad: documento, selfie, prueba de vida.', ubicacion: 'services/api/src/kyc', estado: 'hecho' },
    M_PROFILE: { title: 'ProfileModule', tipo: 'Módulo NestJS', descripcion: 'Perfil, avatar, portafolio y preferencias.', ubicacion: 'services/api/src/profile', estado: 'hecho' },
    M_PROP: { title: 'PropertiesModule', tipo: 'Módulo NestJS', descripcion: 'Propiedades del Host con ubicación PostGIS.', ubicacion: 'services/api/src/properties', estado: 'hecho' },
    M_OFFERS: { title: 'OffersModule', tipo: 'Módulo NestJS', descripcion: 'Publicación de ofertas, radar, expansión de radio y entrega por niveles.', ubicacion: 'services/api/src/offers', estado: 'hecho' },
    M_NEGO: { title: 'NegotiationModule', tipo: 'Módulo NestJS', descripcion: 'Contraofertas entre Host y Cleaner.', ubicacion: 'services/api/src/negotiation', estado: 'hecho' },
    M_FAV: { title: 'FavoritesModule', tipo: 'Módulo NestJS', descripcion: 'Cleaners favoritos con ventana de prioridad.', ubicacion: 'services/api/src/favorites', estado: 'hecho' },
    M_PAY: { title: 'PaymentsModule', tipo: 'Módulo NestJS', descripcion: 'Escrow con Stripe Connect: cobro, retención, liberación y reembolso.', ubicacion: 'services/api/src/payments', estado: 'parcial' },
    M_SUBS: { title: 'SubscriptionsModule', tipo: 'Módulo NestJS', descripcion: 'Planes PRO vía webhooks de RevenueCat.', ubicacion: 'services/api/src/subscriptions', estado: 'parcial' },
    M_COMM: { title: 'CommissionModule', tipo: 'Módulo NestJS', descripcion: 'Comisión del 13% (10% Host + 3% Cleaner).', ubicacion: 'services/api/src/commission', estado: 'hecho' },
    M_CHAT: { title: 'ChatModule', tipo: 'Módulo NestJS', descripcion: 'Chat en tiempo real con traducción, notas de voz y llamadas VoIP.', ubicacion: 'services/api/src/chat', estado: 'hecho' },
    M_NOTIF: { title: 'NotificationsModule', tipo: 'Módulo NestJS', descripcion: 'Notificaciones push e in-app.', ubicacion: 'services/api/src/notifications', estado: 'parcial' },
    M_TRACK: { title: 'ServiceTrackingModule', tipo: 'Módulo NestJS', descripcion: 'Sesión del servicio: en camino, llegó, inició, GPS.', ubicacion: 'services/api/src/service-tracking', estado: 'hecho' },
    M_VIDEO: { title: 'VideoVerificationModule', tipo: 'Módulo NestJS', descripcion: 'Verificación facial del Cleaner al llegar.', ubicacion: 'services/api/src/video-verification', estado: 'hecho' },
    M_CHECK: { title: 'ChecklistPhotosModule', tipo: 'Módulo NestJS', descripcion: 'Checklist con fotos antes/después.', ubicacion: 'services/api/src/checklist-photos', estado: 'hecho' },
    M_COMP: { title: 'ServiceCompletionModule', tipo: 'Módulo NestJS', descripcion: 'Confirmación, calificación y orden de liberar el pago.', ubicacion: 'services/api/src/service-completion', estado: 'hecho' },
    M_DISP: { title: 'DisputeSystemModule', tipo: 'Módulo NestJS', descripcion: 'Disputas con resolución por reembolso o liberación.', ubicacion: 'services/api/src/dispute-system', estado: 'hecho' },
  },
});
