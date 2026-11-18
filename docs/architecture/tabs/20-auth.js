/**
 * 20-auth.js — autenticación: AuthModule (NestJS) + Keycloak (OIDC + PKCE) + pantallas y store del móvil.
 */
BidCleanArch.registerTab({
  id: 'auth',
  group: 'Dominios del negocio',
  order: 200,
  title: 'Autenticación',
  summary:
    'Keycloak es la única fuente de verdad de identidad y credenciales; la API NestJS valida los JWT, sincroniza el correo verificado '
    + 'y guarda metadatos de sesión. El móvil usa Authorization Code + <strong>PKCE</strong> en el navegador del sistema, con login social '
    + '(Google y Apple vía Keycloak) y login biométrico por desafío firmado. '
    + '<strong>Pendiente:</strong> Apple Sign-In está habilitado en el realm pero con <code>clientId</code> y <code>clientSecret</code> de ejemplo.',
  diagrams: [
    {
      title: 'Flujo de login y registro (OIDC + PKCE)',
      description: 'Desde la pantalla de bienvenida hasta la app principal. Los rombos son decisiones; los pasos de la API están marcados con su endpoint.',
      code: `flowchart TD
  L_WELCOME["WelcomeScreen<br/>Empezar / Iniciar sesión"]
  L_CHOICE{"¿Registro o login?"}
  L_REGISTER["RegisterScreen<br/>nombre, país, idioma"]
  L_OAUTH["useOAuth<br/>code_verifier + code_challenge S256"]
  L_CONFIG["oauth.config<br/>realm bidclean, client bidclean-mobile"]
  L_BROWSER["Navegador del sistema<br/>expo-web-browser"]
  L_KC["Keycloak<br/>formulario de login o registro"]
  L_SOCIAL{"¿Login social?"}
  L_GOOGLE["Google OAuth<br/>vía Identity Provider"]
  L_APPLE["Apple Sign-In<br/>vía Identity Provider"]
  L_REDIRECT["Redirección bidclean://<br/>con authorization code"]
  L_CALLBACK["POST /auth/callback<br/>code + code_verifier"]
  L_AUTHSVC["AuthService + KeycloakService<br/>canje del code por tokens"]
  L_DB[("PostgreSQL<br/>users, auth_sessions")]
  L_STORE["auth.store<br/>tokens en SecureStore"]
  L_VERIFIED{"¿Correo verificado?"}
  L_VERIFY["VerifyEmailScreen<br/>reenvío con espera de 60 s"]
  L_BIOSET["BiometricSetupScreen<br/>par de llaves del dispositivo"]
  L_ROLES["Selección de rol<br/>(ver Roles, perfil y KYC)"]
  L_HOME(["App principal"])

  L_WELCOME --> L_CHOICE
  L_CHOICE -->|registro| L_REGISTER --> L_OAUTH
  L_CHOICE -->|login| L_OAUTH
  L_CONFIG -.-> L_OAUTH
  L_OAUTH --> L_BROWSER --> L_KC --> L_SOCIAL
  L_SOCIAL -->|Google| L_GOOGLE --> L_REDIRECT
  L_SOCIAL -->|Apple| L_APPLE --> L_REDIRECT
  L_SOCIAL -->|correo y contraseña| L_REDIRECT
  L_REDIRECT --> L_CALLBACK --> L_AUTHSVC
  L_AUTHSVC --> L_DB
  L_AUTHSVC -->|tokens y usuario| L_STORE --> L_VERIFIED
  L_VERIFIED -->|no| L_VERIFY --> L_BIOSET
  L_VERIFIED -->|sí| L_BIOSET
  L_BIOSET --> L_ROLES --> L_HOME`,
    },
    {
      title: 'Login biométrico y renovación de sesión',
      description: 'Tras el primer login el dispositivo registra una llave pública. Los accesos siguientes firman un desafío (nonce) con la llave privada.',
      code: `flowchart LR
  B_HOOK["useBiometricLogin<br/>orquesta el flujo"]
  B_PROMPT["expo-local-authentication<br/>huella / Face ID"]
  B_CHALLENGE["POST /auth/biometric/challenge<br/>genera nonce"]
  B_SIGN["Firma del desafío<br/>llave privada del dispositivo"]
  B_VERIFY["POST /auth/biometric/verify<br/>valida firma"]
  B_SVC["BiometricService<br/>credenciales y desafíos"]
  B_DB[("PostgreSQL<br/>biometric_credentials<br/>biometric_challenges")]
  B_TOKENS["Tokens nuevos"]
  B_STORE["auth.store<br/>SecureStore"]
  B_REFRESH["POST /auth/refresh<br/>renueva access token"]
  B_KC["Keycloak<br/>emite y revoca tokens"]
  B_HOOK --> B_CHALLENGE --> B_SVC
  B_SVC --> B_DB
  B_HOOK --> B_PROMPT --> B_SIGN --> B_VERIFY --> B_SVC
  B_SVC -->|firma válida| B_KC
  B_KC --> B_TOKENS --> B_STORE
  B_STORE -->|access token vencido| B_REFRESH --> B_KC`,
    },
    {
      title: 'Estructura del módulo AuthModule',
      description: 'Controladores, servicios, guards y servicios de soporte de <code>services/api/src/auth</code>.',
      code: `flowchart TB
  subgraph MOVIL["App móvil"]
    M_SCREENS["Pantallas de auth<br/>Welcome, Register, VerifyEmail, BiometricSetup"]
    M_STORE["auth.store<br/>Zustand"]
  end
  subgraph API["AuthModule NestJS"]
    A_CTRL["AuthController<br/>/auth/*"]
    A_CENT_CTRL["CentrifugoController<br/>/auth/centrifugo/token"]
    A_SERVICE["AuthService<br/>orquesta los flujos"]
    A_KCSVC["KeycloakService<br/>Admin API y token exchange"]
    A_SYNC["EmailVerificationSyncService<br/>sincroniza correo verificado"]
    A_SESSION["SessionService<br/>sesiones por dispositivo"]
    A_BIO["BiometricService"]
    A_CENT_TOKEN["CentrifugoTokenService<br/>tokens HMAC-SHA256"]
    A_JWT["JwtAuthGuard<br/>valida JWT con JWKS"]
    A_RATE["RateLimitGuard<br/>contadores en Redis"]
  end
  subgraph INFRA["Infraestructura"]
    X_KC["Keycloak 25<br/>realm bidclean"]
    X_PG[("PostgreSQL")]
    X_REDIS[("Redis")]
    X_CENT["Centrifugo"]
  end
  M_SCREENS --> A_CTRL
  M_STORE --> A_CTRL
  A_CTRL --> A_JWT
  A_CTRL --> A_RATE
  A_CTRL --> A_SERVICE
  A_SERVICE --> A_KCSVC --> X_KC
  A_SERVICE --> A_SESSION --> X_PG
  A_SERVICE --> A_BIO --> X_PG
  A_SERVICE --> A_SYNC
  A_SYNC --> X_KC
  A_SYNC --> X_PG
  A_RATE --> X_REDIS
  A_JWT --> X_KC
  A_CENT_CTRL --> A_CENT_TOKEN --> X_CENT
  M_STORE -->|token WebSocket| A_CENT_CTRL`,
    },
  ],
  nodes: {
    L_WELCOME: { title: 'WelcomeScreen', tipo: 'Pantalla móvil', descripcion: 'Pantalla inicial con animación del logo y los botones Empezar e Iniciar sesión.', tecnologia: 'React Native + Reanimated 3', ubicacion: 'apps/mobile/src/screens/auth/WelcomeScreen.tsx', estado: 'hecho' },
    L_CHOICE: { title: '¿Registro o login?', tipo: 'Decisión', descripcion: 'Empezar abre el registro; Iniciar sesión abre directamente Keycloak. Ambos usan el mismo hook OAuth.', estado: 'hecho' },
    L_REGISTER: { title: 'RegisterScreen', tipo: 'Pantalla móvil', descripcion: 'Formulario de nombre completo, país (ISO 3166-1) e idioma (BCP 47) antes de pasar al formulario de registro de Keycloak.', ubicacion: 'apps/mobile/src/screens/auth/RegisterScreen.tsx', estado: 'hecho' },
    L_OAUTH: { title: 'useOAuth', tipo: 'Hook móvil', descripcion: 'Genera el code_verifier (32 bytes aleatorios) y el code_challenge SHA-256, abre el navegador y envía el code a la API. El registro agrega kc_action=register. Devuelve errores tipados: user_cancelled, network_error, invalid_code, token_exchange_failed, unknown.', tecnologia: 'expo-auth-session + expo-crypto', ubicacion: 'apps/mobile/src/screens/auth/useOAuth.ts', consume: ['oauth.config'], produce: ['code + code_verifier'], estado: 'hecho' },
    L_CONFIG: { title: 'oauth.config', tipo: 'Configuración móvil', descripcion: 'Constantes OAuth: realm bidclean, dominio auth.bidclean.tech, client bidclean-mobile, esquema de deep link bidclean y scopes openid profile email offline_access.', ubicacion: 'apps/mobile/src/screens/auth/oauth.config.ts', estado: 'parcial', nota: 'Valores fijos en el archivo; para producción deben pasar a configuración por entorno.' },
    L_BROWSER: { title: 'Navegador del sistema', tipo: 'Cliente', descripcion: 'El login ocurre fuera de la app, en el navegador del sistema, para que la app nunca vea la contraseña.', tecnologia: 'expo-web-browser', ubicacion: 'apps/mobile/src/screens/auth/useOAuth.ts', estado: 'hecho' },
    L_KC: { title: 'Keycloak', tipo: 'Proveedor de identidad', descripcion: 'Muestra el formulario de login o registro, aplica detección de fuerza bruta y envía el correo de verificación.', tecnologia: 'Keycloak 25 (realm bidclean)', ubicacion: 'infra/keycloak/realm-export.json', adr: 'ADR-004', estado: 'hecho' },
    L_SOCIAL: { title: '¿Login social?', tipo: 'Decisión', descripcion: 'Keycloak ofrece correo/contraseña, Google y Apple. NestJS nunca recibe tokens de Google ni de Apple.', estado: 'hecho' },
    L_GOOGLE: { title: 'Google OAuth', tipo: 'Identity Provider', descripcion: 'Proveedor social configurado en Keycloak con First Broker Login para enlazar cuentas con el mismo correo.', tecnologia: 'Keycloak Identity Brokering', ubicacion: 'infra/keycloak/realm-export.json', estado: 'parcial', nota: 'Habilitado con credenciales de ejemplo; faltan clientId y clientSecret reales de Google.' },
    L_APPLE: { title: 'Apple Sign-In', tipo: 'Identity Provider', descripcion: 'Proveedor Apple definido en el realm de Keycloak. No hay botón propio en las pantallas móviles: se accede desde el formulario de Keycloak.', tecnologia: 'Keycloak Identity Brokering', ubicacion: 'infra/keycloak/realm-export.json', estado: 'parcial', nota: 'Pendiente: configurar clientId y clientSecret reales de Apple Sign-In en Keycloak.' },
    L_REDIRECT: { title: 'Redirección con code', tipo: 'Paso OIDC', descripcion: 'Keycloak vuelve a la app con el authorization code por el deep link bidclean://.', estado: 'hecho' },
    L_CALLBACK: { title: 'POST /auth/callback', tipo: 'Endpoint', descripcion: 'Recibe code y code_verifier desde el móvil. Público, sin JWT.', ubicacion: 'services/api/src/auth/auth.controller.ts', consume: ['code', 'code_verifier'], produce: ['tokens', 'usuario'], estado: 'hecho' },
    L_AUTHSVC: { title: 'AuthService + KeycloakService', tipo: 'Servicios NestJS', descripcion: 'Canjea el code por tokens en Keycloak, crea o actualiza el usuario en BidClean, copia emailVerified y registra la sesión del dispositivo.', ubicacion: 'services/api/src/auth/auth.service.ts, services/api/src/auth/keycloak/keycloak.service.ts', estado: 'hecho' },
    L_DB: { title: 'PostgreSQL (users, auth_sessions)', tipo: 'Base de datos', descripcion: 'Tablas users y auth_sessions con metadatos de sesión por dispositivo.', tecnologia: 'PostgreSQL + TypeORM', ubicacion: 'services/api/src/auth/entities', estado: 'hecho' },
    L_STORE: { title: 'auth.store', tipo: 'Store Zustand', descripcion: 'Guarda usuario, tokens y estado biométrico. Los tokens se persisten cifrados con SecureStore.', tecnologia: 'Zustand + expo-secure-store', ubicacion: 'apps/mobile/src/stores/auth.store.ts', adr: 'ADR-003', estado: 'hecho' },
    L_VERIFIED: { title: '¿Correo verificado?', tipo: 'Decisión', descripcion: 'El estado users.is_email_verified refleja a Keycloak y limita acciones como crear ofertas.', estado: 'hecho' },
    L_VERIFY: { title: 'VerifyEmailScreen', tipo: 'Pantalla móvil', descripcion: 'Muestra el estado de verificación y permite reenviar el correo con una espera de 60 segundos.', ubicacion: 'apps/mobile/src/screens/auth/VerifyEmailScreen.tsx', estado: 'hecho' },
    L_BIOSET: { title: 'BiometricSetupScreen', tipo: 'Pantalla móvil', descripcion: 'Pide la biometría, genera el par de llaves y registra la llave pública con POST /auth/biometric/register.', ubicacion: 'apps/mobile/src/screens/auth/BiometricSetupScreen.tsx', estado: 'hecho' },
    L_ROLES: { title: 'Selección de rol', tipo: 'Paso siguiente', descripcion: 'Con sesión y correo verificado, el usuario elige Host, Cleaner o ambos.', ubicacion: 'apps/mobile/src/screens/roles/RoleSelectionScreen.tsx', estado: 'hecho' },
    L_HOME: { title: 'App principal', tipo: 'Fin', descripcion: 'El usuario entra a la experiencia de su rol activo.', estado: 'hecho' },

    B_HOOK: { title: 'useBiometricLogin', tipo: 'Hook móvil', descripcion: 'Orquesta el login biométrico: pide el desafío, solicita huella o Face ID, firma el nonce, lo verifica en el servidor y guarda los tokens. Expone loading, error y disponibilidad. Errores: challenge_expired, signature_invalid, biometric_cancelled, biometric_unavailable, network_error.', ubicacion: 'apps/mobile/src/screens/auth/useBiometricLogin.ts', estado: 'hecho' },
    B_PROMPT: { title: 'Prompt biométrico', tipo: 'API del dispositivo', descripcion: 'Huella o Face ID del sistema operativo.', tecnologia: 'expo-local-authentication', estado: 'hecho' },
    B_CHALLENGE: { title: 'POST /auth/biometric/challenge', tipo: 'Endpoint', descripcion: 'Genera un nonce de un solo uso para el dispositivo (se identifica con el device id).', ubicacion: 'services/api/src/auth/auth.controller.ts', produce: ['nonce'], estado: 'hecho' },
    B_SIGN: { title: 'Firma del desafío', tipo: 'Paso móvil', descripcion: 'El móvil firma el nonce con la llave privada que nunca sale del dispositivo.', tecnologia: 'expo-crypto', estado: 'hecho' },
    B_VERIFY: { title: 'POST /auth/biometric/verify', tipo: 'Endpoint', descripcion: 'Comprueba la firma contra la llave pública registrada y entrega tokens.', ubicacion: 'services/api/src/auth/auth.controller.ts', consume: ['nonce firmado'], produce: ['tokens'], estado: 'hecho' },
    B_SVC: { title: 'BiometricService', tipo: 'Servicio NestJS', descripcion: 'Guarda credenciales, genera desafíos y verifica firmas.', ubicacion: 'services/api/src/auth/biometric/biometric.service.ts', estado: 'hecho' },
    B_DB: { title: 'PostgreSQL (credenciales biométricas)', tipo: 'Base de datos', descripcion: 'Entidades BiometricCredential y BiometricChallenge.', ubicacion: 'services/api/src/auth/entities/biometric-credential.entity.ts, services/api/src/auth/entities/biometric-challenge.entity.ts', estado: 'hecho' },
    B_TOKENS: { title: 'Tokens nuevos', tipo: 'Datos', descripcion: 'Access token, refresh token y datos del usuario.', estado: 'hecho' },
    B_STORE: { title: 'auth.store', tipo: 'Store Zustand', descripcion: 'Actualiza el estado de autenticación y persiste los tokens.', ubicacion: 'apps/mobile/src/stores/auth.store.ts', estado: 'hecho' },
    B_REFRESH: { title: 'POST /auth/refresh', tipo: 'Endpoint', descripcion: 'Renueva el access token usando el refresh token.', ubicacion: 'services/api/src/auth/auth.controller.ts', estado: 'hecho' },
    B_KC: { title: 'Keycloak', tipo: 'Proveedor de identidad', descripcion: 'Emite, renueva y revoca los tokens.', tecnologia: 'Keycloak 25', ubicacion: 'infra/keycloak', adr: 'ADR-004', estado: 'hecho' },

    M_SCREENS: { title: 'Pantallas de auth', tipo: 'Pantallas móviles', descripcion: 'WelcomeScreen, RegisterScreen, VerifyEmailScreen y BiometricSetupScreen más los hooks useOAuth y useBiometricLogin.', ubicacion: 'apps/mobile/src/screens/auth', estado: 'hecho' },
    M_STORE: { title: 'auth.store', tipo: 'Store Zustand', descripcion: 'Estado de sesión del cliente. También entrega el token de conexión WebSocket a Centrifugo.', ubicacion: 'apps/mobile/src/stores/auth.store.ts', estado: 'hecho' },
    A_CTRL: { title: 'AuthController', tipo: 'Controlador NestJS', descripcion: 'Endpoints /auth/register, login-url, callback, refresh, logout, logout-all, biometric/* y me.', ubicacion: 'services/api/src/auth/auth.controller.ts', estado: 'hecho' },
    A_CENT_CTRL: { title: 'CentrifugoController', tipo: 'Controlador NestJS', descripcion: 'GET /auth/centrifugo/token entrega el token de conexión y, solo si el usuario participa, el token de suscripción a chat:conversation:{id} o service:session:{id}.', ubicacion: 'services/api/src/auth/centrifugo/centrifugo.controller.ts', estado: 'hecho' },
    A_SERVICE: { title: 'AuthService', tipo: 'Servicio NestJS', descripcion: 'Orquesta registro, callback, refresh, logout y biometría coordinando los subservicios.', ubicacion: 'services/api/src/auth/auth.service.ts', estado: 'hecho' },
    A_KCSVC: { title: 'KeycloakService', tipo: 'Cliente de Keycloak', descripcion: 'Cliente de la Admin API: crea usuarios, canjea tokens y revoca sesiones.', ubicacion: 'services/api/src/auth/keycloak/keycloak.service.ts', estado: 'hecho' },
    A_SYNC: { title: 'EmailVerificationSyncService', tipo: 'Servicio programado', descripcion: 'Copia el correo verificado de Keycloak a la base: al hacer login, por sondeo (cada 30 s por defecto, lote de 50) y bajo demanda en GET /auth/me.', ubicacion: 'services/api/src/auth/keycloak/email-verification-sync.service.ts', estado: 'hecho' },
    A_SESSION: { title: 'SessionService', tipo: 'Servicio NestJS', descripcion: 'Metadatos de sesión por dispositivo y cierre de sesión.', ubicacion: 'services/api/src/auth/session/session.service.ts', estado: 'hecho' },
    A_BIO: { title: 'BiometricService', tipo: 'Servicio NestJS', descripcion: 'Almacena la llave pública del dispositivo, emite desafíos y verifica la firma.', ubicacion: 'services/api/src/auth/biometric/biometric.service.ts', estado: 'hecho' },
    A_CENT_TOKEN: { title: 'CentrifugoTokenService', tipo: 'Servicio NestJS', descripcion: 'Firma con HMAC-SHA256 los tokens de conexión y suscripción de Centrifugo.', tecnologia: 'HMAC-SHA256', ubicacion: 'services/api/src/auth/centrifugo/centrifugo-token.service.ts', estado: 'hecho' },
    A_JWT: { title: 'JwtAuthGuard', tipo: 'Guard NestJS', descripcion: 'Valida el JWT de Keycloak con las llaves públicas JWKS. Lo reutilizan todos los módulos protegidos.', ubicacion: 'services/api/src/auth/guards/jwt-auth.guard.ts', estado: 'hecho' },
    A_RATE: { title: 'RateLimitGuard', tipo: 'Guard NestJS', descripcion: 'Limita solicitudes por cliente con contadores en Redis.', ubicacion: 'services/api/src/auth/guards/rate-limit.guard.ts', estado: 'hecho' },
    X_KC: { title: 'Keycloak 25', tipo: 'Proveedor de identidad', descripcion: 'Realm bidclean con clientes bidclean-mobile y de administración.', tecnologia: 'Keycloak', ubicacion: 'infra/keycloak/realm-export.json', adr: 'ADR-004', estado: 'hecho' },
    X_PG: { title: 'PostgreSQL', tipo: 'Base de datos', descripcion: 'Usuarios, sesiones y credenciales biométricas.', tecnologia: 'PostgreSQL 16', estado: 'hecho' },
    X_REDIS: { title: 'Redis', tipo: 'Cache', descripcion: 'Contadores del rate limit.', tecnologia: 'Redis 7', estado: 'hecho' },
    X_CENT: { title: 'Centrifugo', tipo: 'Tiempo real', descripcion: 'Acepta conexiones WebSocket con tokens firmados por AuthModule (secreto CENTRIFUGO_TOKEN_SECRET).', tecnologia: 'Centrifugo v5', estado: 'hecho' },
  },
  sections: [
    {
      title: 'Endpoints de autenticación',
      html: `<table>
<thead><tr><th>Método</th><th>Ruta</th><th>Descripción</th></tr></thead>
<tbody>
<tr><td>POST</td><td><code>/auth/register</code></td><td>Registra un usuario (Keycloak + BidClean)</td></tr>
<tr><td>GET</td><td><code>/auth/login-url</code></td><td>URL de login de Keycloak con redirección PKCE</td></tr>
<tr><td>POST</td><td><code>/auth/callback</code></td><td>Canjea el authorization code por tokens</td></tr>
<tr><td>POST</td><td><code>/auth/refresh</code></td><td>Renueva el access token con el refresh token</td></tr>
<tr><td>POST</td><td><code>/auth/logout</code></td><td>Cierra la sesión del dispositivo actual</td></tr>
<tr><td>POST</td><td><code>/auth/logout-all</code></td><td>Cierra todas las sesiones del usuario</td></tr>
<tr><td>POST</td><td><code>/auth/biometric/register</code></td><td>Guarda la llave pública del dispositivo</td></tr>
<tr><td>POST</td><td><code>/auth/biometric/challenge</code></td><td>Genera el nonce para verificar biometría</td></tr>
<tr><td>POST</td><td><code>/auth/biometric/verify</code></td><td>Verifica la firma y entrega tokens</td></tr>
<tr><td>GET</td><td><code>/auth/me</code></td><td>Datos del usuario actual (revisa el correo verificado bajo demanda)</td></tr>
<tr><td>GET</td><td><code>/auth/centrifugo/token</code></td><td>Token de conexión o de suscripción a un canal de Centrifugo</td></tr>
</tbody></table>`,
    },
    {
      title: 'Notas y pendientes',
      html: `<ul>
<li><strong>Apple Sign-In:</strong> el proveedor existe en el realm de Keycloak (<code>infra/keycloak/realm-export.json</code>), pero con credenciales de ejemplo. Estado: parcial.</li>
<li><strong>Registro desde el móvil:</strong> <code>useOAuth</code> usa <code>kc_action=register</code> sobre el flujo OAuth. No se verificó que alguna pantalla móvil llame a <code>POST /auth/register</code>.</li>
<li><strong>Variables de entorno de la API:</strong> <code>KEYCLOAK_URL</code>, <code>KEYCLOAK_REALM</code>, <code>KEYCLOAK_CLIENT_ID</code>, <code>KEYCLOAK_CLIENT_SECRET</code>, <code>KEYCLOAK_ADMIN_CLIENT_ID</code>, <code>KEYCLOAK_ADMIN_CLIENT_SECRET</code>, <code>REDIS_URL</code>.</li>
<li><strong>Specs:</strong> <code>.kiro/specs/user-authentication</code> (completado según el ROADMAP).</li>
</ul>`,
    },
  ],
});
