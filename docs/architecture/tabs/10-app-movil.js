/**
 * 10-app-movil.js — estructura de la app móvil (Expo Router, navegación por rol, pantallas, stores) y sus conexiones externas.
 */
BidCleanArch.registerTab({
  id: 'app-movil',
  group: 'Frontend',
  order: 100,
  title: 'App móvil',
  summary:
    'Una sola app React Native + Expo para Host y Cleaner. Las rutas viven en apps/mobile/app (Expo Router), la navegación por rol en src/navigation '
    + 'y la lógica por funcionalidad en src/screens. El segundo diagrama muestra con qué servicios habla la app.',
  diagrams: [
    {
      title: 'Estructura interna de la app',
      description: 'Rutas, navegación por rol, pantallas por funcionalidad, stores y código compartido.',
      code: `flowchart TB
  subgraph RUTAS["Rutas Expo Router"]
    ROUTES["app/<br/>_layout, index, login, register, home, roles/selection"]
  end
  subgraph NAVEGACION["src/navigation"]
    NAV_ROLE["RoleBasedNavigator"]
    NAV_HOST["HostNavigator"]
    NAV_CLEANER["CleanerNavigator"]
  end
  subgraph PANTALLAS["src/screens"]
    SC_AUTH["auth"]
    SC_ROLES["roles"]
    SC_KYC["kyc"]
    SC_PROFILE["profile"]
    SC_PROPS["properties"]
    SC_OFFERS["offers"]
    SC_RADAR["radar"]
    SC_NEGO["negotiation"]
    SC_FAV["favorites"]
    SC_PAY["payments"]
    SC_SUBS["subscriptions"]
    SC_ADS["ads"]
    SC_CHAT["chat"]
    SC_TRACK["tracking"]
    SC_VERIF["verification"]
    SC_CHECK["checklist"]
    SC_COMP["completion"]
    SC_DISPUTE["dispute"]
    SC_NOTIF["notifications"]
    SC_APPEAR["appearance"]
  end
  subgraph COMPARTIDO["Código compartido"]
    ST_AUTH["auth.store"]
    ST_ROLE["role.store"]
    SERVICES["src/services<br/>api, tokenRefresh, secureStorage"]
    I18N["src/i18n"]
    THEME["src/theme"]
    COMPONENTS["src/components"]
    HOOKS["src/hooks"]
  end
  ROUTES --> NAV_ROLE
  NAV_ROLE -->|rol host| NAV_HOST
  NAV_ROLE -->|rol cleaner| NAV_CLEANER
  NAV_ROLE -->|sin rol| SC_ROLES
  ROUTES --> SC_AUTH
  NAV_HOST --> SC_PROPS
  NAV_HOST --> SC_OFFERS
  NAV_HOST --> SC_PROFILE
  NAV_CLEANER --> SC_RADAR
  NAV_CLEANER --> SC_TRACK
  NAV_CLEANER --> SC_PROFILE
  SC_RADAR --> SC_NEGO
  SC_OFFERS --> SC_NEGO
  SC_OFFERS --> SC_FAV
  SC_TRACK --> SC_VERIF
  SC_TRACK --> SC_CHECK
  SC_CHECK --> SC_COMP
  SC_COMP --> SC_DISPUTE
  SC_AUTH --> ST_AUTH
  SC_ROLES --> ST_ROLE
  NAV_ROLE --> ST_ROLE
  ST_AUTH --> SERVICES
  SC_AUTH --> SC_KYC
  SC_PAY --> SERVICES
  SC_CHAT --> SERVICES
  SC_NOTIF --> SERVICES
  SC_SUBS --> SC_ADS
  SC_APPEAR --> THEME
  SC_PROFILE --> I18N
  SC_PROFILE --> COMPONENTS
  SC_PROFILE --> HOOKS`,
    },
    {
      title: 'Conexiones de la app con servicios',
      description: 'Protocolo y servicio al que llama cada funcionalidad.',
      code: `flowchart LR
  RN_APP["App móvil<br/>React Native + Expo"]
  EXT_API["API REST<br/>api.bidclean.tech"]
  EXT_WS["Centrifugo<br/>WebSocket"]
  EXT_KC["Keycloak<br/>OIDC + PKCE"]
  EXT_LK["LiveKit<br/>WebRTC"]
  EXT_MAP["Mapbox"]
  EXT_RC["RevenueCat"]
  EXT_ADMOB["AdMob"]
  EXT_STRIPE["Stripe SDK"]
  RN_APP -->|HTTPS + JWT| EXT_API
  RN_APP -->|tiempo real| EXT_WS
  RN_APP -->|login| EXT_KC
  RN_APP -->|llamadas y video| EXT_LK
  RN_APP -->|mapas| EXT_MAP
  RN_APP -->|compras| EXT_RC
  RN_APP -->|anuncios| EXT_ADMOB
  RN_APP -->|hoja de pago| EXT_STRIPE
  EXT_KC -.->|emite JWT| EXT_API`,
    },
  ],
  nodes: {
    ROUTES: { title: 'app/ (Expo Router)', tipo: 'Rutas', descripcion: 'Rutas por archivo: _layout, index, login, register, home, roles/selection y error-boundary.', tecnologia: 'expo-router', ubicacion: 'apps/mobile/app', adr: 'ADR-001', estado: 'hecho' },
    NAV_ROLE: { title: 'RoleBasedNavigator', tipo: 'Navegación', descripcion: 'Lee el rol activo del store y muestra el navegador de Host, el de Cleaner o redirige a la selección de rol.', tecnologia: 'React Native', ubicacion: 'apps/mobile/src/navigation/RoleBasedNavigator.tsx', consume: ['role.store'], estado: 'hecho' },
    NAV_HOST: { title: 'HostNavigator', tipo: 'Navegación', descripcion: 'Pestañas del Host: Inicio, Propiedades, Ofertas y Perfil.', ubicacion: 'apps/mobile/src/navigation/HostNavigator.tsx', estado: 'parcial', nota: 'La pestaña Inicio es un placeholder.' },
    NAV_CLEANER: { title: 'CleanerNavigator', tipo: 'Navegación', descripcion: 'Pestañas del Cleaner: Radar, Activo y Perfil.', ubicacion: 'apps/mobile/src/navigation/CleanerNavigator.tsx', estado: 'hecho' },
    SC_AUTH: { title: 'Pantallas auth', tipo: 'Pantallas', descripcion: 'Registro, login, verificación de email y biometría.', ubicacion: 'apps/mobile/src/screens/auth', consume: ['auth.store'], estado: 'hecho' },
    SC_ROLES: { title: 'Pantallas roles', tipo: 'Pantallas', descripcion: 'Selección de rol y onboarding de Host y Cleaner.', ubicacion: 'apps/mobile/src/screens/roles', estado: 'hecho' },
    SC_KYC: { title: 'Pantallas kyc', tipo: 'Pantallas', descripcion: 'Captura de documento, selfie y prueba de vida.', ubicacion: 'apps/mobile/src/screens/kyc', estado: 'hecho' },
    SC_PROFILE: { title: 'Pantallas profile', tipo: 'Pantallas', descripcion: 'Perfil, avatar, portafolio y preferencias.', ubicacion: 'apps/mobile/src/screens/profile', estado: 'hecho' },
    SC_PROPS: { title: 'Pantallas properties', tipo: 'Pantallas', descripcion: 'Lista y alta de propiedades del Host.', ubicacion: 'apps/mobile/src/screens/properties', estado: 'hecho' },
    SC_OFFERS: { title: 'Pantallas offers', tipo: 'Pantallas', descripcion: 'Publicación y seguimiento de ofertas del Host.', ubicacion: 'apps/mobile/src/screens/offers', estado: 'hecho' },
    SC_RADAR: { title: 'Pantallas radar', tipo: 'Pantallas', descripcion: 'Radar del Cleaner con mapa y ofertas cercanas en tiempo real.', ubicacion: 'apps/mobile/src/screens/radar', estado: 'hecho' },
    SC_NEGO: { title: 'Pantallas negotiation', tipo: 'Pantallas', descripcion: 'Contraofertas entre Host y Cleaner.', ubicacion: 'apps/mobile/src/screens/negotiation', estado: 'hecho' },
    SC_FAV: { title: 'Pantallas favorites', tipo: 'Pantallas', descripcion: 'Cleaners favoritos del Host.', ubicacion: 'apps/mobile/src/screens/favorites', estado: 'hecho' },
    SC_PAY: { title: 'Pantallas payments', tipo: 'Pantallas', descripcion: 'Métodos de pago y estado del escrow.', ubicacion: 'apps/mobile/src/screens/payments', estado: 'parcial', nota: 'Depende de credenciales reales de Stripe.' },
    SC_SUBS: { title: 'Pantallas subscriptions', tipo: 'Pantallas', descripcion: 'Planes Cleaner PRO y Host PRO.', ubicacion: 'apps/mobile/src/screens/subscriptions', estado: 'parcial', nota: 'Depende de credenciales de RevenueCat.' },
    SC_ADS: { title: 'Pantallas ads', tipo: 'Pantallas', descripcion: 'Anuncios para usuarios del plan gratuito.', ubicacion: 'apps/mobile/src/screens/ads', estado: 'parcial', nota: 'Usa el id de prueba de AdMob por defecto.' },
    SC_CHAT: { title: 'Pantallas chat', tipo: 'Pantallas', descripcion: 'Chat con traducción, notas de voz y llamadas.', ubicacion: 'apps/mobile/src/screens/chat', estado: 'parcial', nota: 'Las llamadas dependen de LiveKit, aún sin desplegar.' },
    SC_TRACK: { title: 'Pantallas tracking', tipo: 'Pantallas', descripcion: 'Seguimiento del servicio: en camino, llegada e inicio.', ubicacion: 'apps/mobile/src/screens/tracking', estado: 'hecho' },
    SC_VERIF: { title: 'Pantallas verification', tipo: 'Pantallas', descripcion: 'Verificación facial del Cleaner al llegar.', ubicacion: 'apps/mobile/src/screens/verification', estado: 'hecho' },
    SC_CHECK: { title: 'Pantallas checklist', tipo: 'Pantallas', descripcion: 'Checklist con fotos antes y después.', ubicacion: 'apps/mobile/src/screens/checklist', estado: 'hecho' },
    SC_COMP: { title: 'Pantallas completion', tipo: 'Pantallas', descripcion: 'Confirmación y calificación del servicio.', ubicacion: 'apps/mobile/src/screens/completion', estado: 'hecho' },
    SC_DISPUTE: { title: 'Pantallas dispute', tipo: 'Pantallas', descripcion: 'Apertura y seguimiento de disputas.', ubicacion: 'apps/mobile/src/screens/dispute', estado: 'hecho' },
    SC_NOTIF: { title: 'Pantallas notifications', tipo: 'Pantallas', descripcion: 'Bandeja de notificaciones in-app.', ubicacion: 'apps/mobile/src/screens/notifications', estado: 'hecho' },
    SC_APPEAR: { title: 'Pantallas appearance', tipo: 'Pantallas', descripcion: 'Selector de tema oscuro, claro o del sistema.', ubicacion: 'apps/mobile/src/screens/appearance', estado: 'hecho' },
    ST_AUTH: { title: 'auth.store', tipo: 'Store Zustand', descripcion: 'Sesión, tokens y usuario autenticado.', tecnologia: 'Zustand', ubicacion: 'apps/mobile/src/stores/auth.store.ts', estado: 'hecho' },
    ST_ROLE: { title: 'role.store', tipo: 'Store Zustand', descripcion: 'Rol activo (host o cleaner) que decide la navegación.', tecnologia: 'Zustand', ubicacion: 'apps/mobile/src/stores/role.store.ts', estado: 'hecho' },
    SERVICES: { title: 'src/services', tipo: 'Cliente HTTP', descripcion: 'Cliente axios hacia la API, renovación de token y almacenamiento seguro.', tecnologia: 'axios + expo-secure-store', ubicacion: 'apps/mobile/src/services', produce: ['Peticiones REST con JWT'], estado: 'hecho' },
    I18N: { title: 'src/i18n', tipo: 'Internacionalización', descripcion: 'Configuración de i18next con recursos en español e inglés.', tecnologia: 'i18next', ubicacion: 'apps/mobile/src/i18n', estado: 'parcial', nota: 'Hay recursos en y es; faltan FR, DE, IT, PT y NL.' },
    THEME: { title: 'src/theme', tipo: 'Sistema de diseño', descripcion: 'Tokens, ThemeProvider y puente al tema de navegación. Los colores hex solo viven en primitives.ts.', ubicacion: 'apps/mobile/src/theme', estado: 'hecho' },
    COMPONENTS: { title: 'src/components', tipo: 'Componentes compartidos', descripcion: 'Componentes reutilizables entre pantallas.', ubicacion: 'apps/mobile/src/components', estado: 'parcial', nota: 'Por ahora solo tiene documentación.' },
    HOOKS: { title: 'src/hooks', tipo: 'Hooks compartidos', descripcion: 'Hooks reutilizables entre pantallas.', ubicacion: 'apps/mobile/src/hooks', estado: 'parcial', nota: 'Por ahora solo tiene documentación.' },
    RN_APP: { title: 'App móvil', tipo: 'Frontend', descripcion: 'React Native 0.76 + Expo SDK 52. No corre en Expo Go por usar módulos nativos.', tecnologia: 'React Native + Expo', ubicacion: 'apps/mobile', estado: 'hecho' },
    EXT_API: { title: 'API REST', tipo: 'Backend', descripcion: 'API NestJS. La app envía el JWT de Keycloak en cada petición.', tecnologia: 'NestJS', ubicacion: 'services/api', estado: 'hecho' },
    EXT_WS: { title: 'Centrifugo', tipo: 'Tiempo real', descripcion: 'Radar de ofertas, chat, seguimiento y estados del servicio.', tecnologia: 'Centrifugo v5', ubicacion: 'infra/centrifugo', estado: 'hecho' },
    EXT_KC: { title: 'Keycloak', tipo: 'Identidad', descripcion: 'Login con OIDC y PKCE; el backend valida los JWT.', tecnologia: 'Keycloak 25', ubicacion: 'infra/keycloak', adr: 'ADR-004', estado: 'hecho' },
    EXT_LK: { title: 'LiveKit', tipo: 'VoIP / video', descripcion: 'Llamadas y video con el SDK de React Native.', tecnologia: '@livekit/react-native', ubicacion: 'rtc.bidclean.tech', estado: 'falta', nota: 'Servidor aún no desplegado; EXPO_PUBLIC_LIVEKIT_URL por defecto vacío.' },
    EXT_MAP: { title: 'Mapbox', tipo: 'Mapas', descripcion: 'Mapa del radar y seguimiento. Necesita token público en runtime y token de descarga en el build.', tecnologia: '@rnmapbox/maps', ubicacion: 'apps/mobile', estado: 'externo' },
    EXT_RC: { title: 'RevenueCat', tipo: 'Suscripciones', descripcion: 'Compra de planes PRO desde la app.', tecnologia: 'react-native-purchases', ubicacion: 'apps/mobile/src/screens/subscriptions', estado: 'parcial', nota: 'Faltan credenciales de producción.' },
    EXT_ADMOB: { title: 'AdMob', tipo: 'Anuncios', descripcion: 'Anuncios para usuarios gratuitos.', tecnologia: 'react-native-google-mobile-ads', ubicacion: 'apps/mobile/src/screens/ads', estado: 'externo' },
    EXT_STRIPE: { title: 'Stripe SDK', tipo: 'Pagos', descripcion: 'Hoja de pago nativa; la clave publicable llega por EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY.', tecnologia: '@stripe/stripe-react-native', ubicacion: 'apps/mobile', estado: 'parcial', nota: 'Falta la clave publicable real.' },
  },
  sections: [
    {
      title: 'Notas',
      html: '<ul><li>La navegación por rol no comparte pantallas entre Host y Cleaner.</li>'
        + '<li><code>newArchEnabled</code> está en <code>false</code>: con la Nueva Arquitectura la app quedaba en blanco al arrancar.</li>'
        + '<li>Un test de Jest y el script <code>hex-guard</code> impiden colores hex fuera de <code>src/theme/primitives.ts</code>.</li></ul>',
    },
  ],
});
