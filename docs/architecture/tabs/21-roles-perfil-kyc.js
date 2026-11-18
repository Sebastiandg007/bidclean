/**
 * 21-roles-perfil-kyc.js — roles Host/Cleaner, perfil de usuario (incluye borrado de cuenta) y verificación de identidad KYC con IA.
 */
BidCleanArch.registerTab({
  id: 'roles-perfil-kyc',
  group: 'Dominios del negocio',
  order: 210,
  title: 'Roles, perfil y KYC',
  summary:
    'Después de autenticarse, el usuario elige ser <strong>Host</strong>, <strong>Cleaner</strong> o ambos (RolesModule) y completa un onboarding por rol. '
    + 'ProfileModule administra datos, fotos, portafolio, preferencias y el borrado asíncrono de cuenta. '
    + 'KycModule verifica la identidad del Cleaner con documento, selfie y tres chequeos de IA (OCR, comparación facial y prueba de vida) '
    + 'ejecutados por el microservicio FastAPI. Un Cleaner sin KYC en estado <code>VERIFIED</code> no puede aceptar ofertas.',
  diagrams: [
    {
      title: 'Roles, onboarding y perfil',
      description: 'Del rol elegido en la app a las tablas de perfil. El OnboardingGateGuard bloquea endpoints de un rol hasta completar su onboarding.',
      code: `flowchart TB
  subgraph MOVIL["App móvil"]
    R_SELECT["RoleSelectionScreen<br/>tarjetas Host y Cleaner"]
    R_HOSTONB["HostOnboardingScreen<br/>nombre y método de pago"]
    R_CLEANONB["CleanerOnboardingScreen<br/>KYC, zona, disponibilidad, especialidades"]
    R_SWITCH["RoleSwitchButton<br/>y AddSecondRoleButton"]
    P_SCREENS["ProfileScreen, EditProfileScreen,<br/>PublicProfileScreen, PortfolioGalleryScreen"]
    P_SETTINGS["SettingsScreen y AccountScreen<br/>idioma, tema, borrar cuenta"]
  end
  subgraph ROLES["RolesModule"]
    R_CTRL["RolesController<br/>/users/*"]
    R_SVC["RolesService<br/>asignar, cambiar rol, perfiles"]
    R_GATE["OnboardingGateGuard<br/>403 si falta onboarding"]
    R_DB[("host_profiles<br/>cleaner_profiles<br/>users.roles y active_role")]
  end
  subgraph PERFIL["ProfileModule"]
    P_CTRL["ProfileController<br/>/profile/*"]
    P_SVC["ProfileService<br/>perfil privado y público"]
    P_PHOTO["ProfilePhotoService<br/>sharp + cifrado AES-256"]
    P_PORT["PortfolioService<br/>fotos del Cleaner"]
    P_SET["SettingsService<br/>idioma, tema, notificaciones"]
    P_COMP["CompletenessService<br/>porcentaje con pesos"]
    P_ACC["AccountService<br/>cambio de correo y clave"]
    P_DB[("profile_details<br/>user_settings<br/>portfolio_photos")]
  end
  subgraph EXT["Infraestructura"]
    X_MINIO[("MinIO<br/>fotos firmadas")]
    X_KC["Keycloak<br/>credenciales y webhook"]
  end
  R_SELECT -->|POST /users/roles| R_CTRL
  R_HOSTONB -->|POST /users/me/host-profile| R_CTRL
  R_CLEANONB -->|POST /users/me/cleaner-profile| R_CTRL
  R_SWITCH -->|PATCH /users/me/active-role| R_CTRL
  R_CTRL --> R_SVC --> R_DB
  R_GATE -.->|protege endpoints por rol| R_SVC
  P_SCREENS --> P_CTRL
  P_SETTINGS --> P_CTRL
  P_CTRL --> P_SVC
  P_CTRL --> P_PHOTO --> X_MINIO
  P_CTRL --> P_PORT --> X_MINIO
  P_CTRL --> P_SET
  P_CTRL --> P_ACC --> X_KC
  P_SVC --> P_COMP
  P_SVC --> P_DB
  P_SET --> P_DB
  P_PORT --> P_DB
  P_SVC -->|lee host y cleaner| R_DB
  X_KC -->|webhook de correo| P_CTRL`,
    },
    {
      title: 'Borrado de cuenta (asíncrono)',
      description: 'La solicitud responde de inmediato; el trabajo pesado corre en la cola BullMQ account-deletion con pasos idempotentes.',
      code: `flowchart LR
  D_MODAL["DeleteAccountModal<br/>escribir palabra de confirmación"]
  D_REQ["POST /profile/me/delete-account"]
  D_SVC["AccountService<br/>marca DELETION_PENDING"]
  D_QUEUE[["Cola BullMQ<br/>account-deletion"]]
  D_JOB["DeletionJobProcessor<br/>cascada idempotente"]
  D_S1["1. Cancelar suscripciones<br/>RevenueCat"]
  D_S2["2. Eliminar usuario<br/>en Keycloak"]
  D_S3["3. Eliminar archivos<br/>en MinIO"]
  D_S4["4. Anonimizar datos<br/>personales"]
  D_DONE(["Cuenta DELETED"])
  D_MODAL --> D_REQ --> D_SVC --> D_QUEUE --> D_JOB
  D_JOB --> D_S1 --> D_S2 --> D_S3 --> D_S4 --> D_DONE`,
    },
    {
      title: 'Verificación de identidad (KYC) con IA',
      description: 'Subida de documento y selfie, procesamiento asíncrono con tres chequeos de IA y decisión automática o revisión de un administrador.',
      code: `flowchart TD
  K_DOC["DocumentCaptureScreen<br/>foto del documento"]
  K_SELFIE["SelfieCaptureScreen<br/>selfie con óvalo facial"]
  K_STATUS["KycStatusScreen<br/>sondea mientras PROCESSING"]
  K_CTRL["KycController<br/>/kyc/*"]
  K_SVC["KycService<br/>orquesta el flujo"]
  K_SM["KycStateTransitionService<br/>máquina de estados con bloqueo"]
  K_STORAGE["KycStorageService<br/>imágenes cifradas"]
  K_MINIO[("MinIO<br/>bucket KYC")]
  K_QUEUE[["Cola BullMQ<br/>procesamiento KYC"]]
  K_JOB["KycProcessJob<br/>pipeline de IA"]
  K_AICLIENT["AiClientService<br/>HTTP con reintentos"]
  subgraph IA["Microservicio IA FastAPI"]
    I_OCR["POST /ai/ocr<br/>PaddleOCR"]
    I_LIVE["POST /ai/liveness<br/>prueba de vida"]
    I_FACE["POST /ai/face-compare<br/>DeepFace"]
  end
  K_NAME["Coincidencia de nombre<br/>similitud Levenshtein"]
  K_EVAL{"¿Puntajes sobre<br/>los umbrales?"}
  K_VERIFIED(["VERIFIED"])
  K_REJECTED(["REJECTED"])
  K_RETRY["POST /kyc/retry<br/>nuevo intento"]
  K_PUSH["KycNotificationService<br/>push OneSignal"]
  K_AUDIT["KycAuditService<br/>auditoría GDPR"]
  K_ADMIN["KycAdminController<br/>revisión manual"]
  K_CLEANUP["KycCleanupJob<br/>borra imágenes 3:00 AM"]
  K_GUARD["KycVerifiedGuard<br/>bloquea aceptar ofertas"]
  K_DB[("kyc_verifications<br/>kyc_audit_logs")]
  K_DOC -->|POST /kyc/document| K_CTRL
  K_SELFIE -->|POST /kyc/selfie| K_CTRL
  K_STATUS -->|GET /kyc/status| K_CTRL
  K_CTRL --> K_SVC
  K_SVC --> K_SM --> K_DB
  K_SVC --> K_STORAGE --> K_MINIO
  K_SVC -->|SELFIE_UPLOADED| K_QUEUE --> K_JOB
  K_JOB --> K_AICLIENT
  K_AICLIENT --> I_OCR --> I_LIVE --> I_FACE
  K_JOB --> K_NAME --> K_EVAL
  K_EVAL -->|sí| K_VERIFIED
  K_EVAL -->|no| K_REJECTED
  K_REJECTED --> K_RETRY --> K_SVC
  K_VERIFIED --> K_PUSH
  K_REJECTED --> K_PUSH
  K_JOB -.->|reintentos agotados| K_ADMIN
  K_ADMIN -->|POST decision| K_SM
  K_SM -.-> K_AUDIT --> K_DB
  K_CLEANUP --> K_MINIO
  K_DB -.->|último intento VERIFIED| K_GUARD`,
    },
  ],
  nodes: {
    R_SELECT: { title: 'RoleSelectionScreen', tipo: 'Pantalla móvil', descripcion: 'Selector de dos tarjetas (Host y Cleaner) con selección simple o doble y animación.', ubicacion: 'apps/mobile/src/screens/roles/RoleSelectionScreen.tsx', estado: 'hecho' },
    R_HOSTONB: { title: 'HostOnboardingScreen', tipo: 'Pantalla móvil', descripcion: 'Dos pasos: confirmar nombre y agregar método de pago.', ubicacion: 'apps/mobile/src/screens/roles/HostOnboardingScreen.tsx', estado: 'hecho' },
    R_CLEANONB: { title: 'CleanerOnboardingScreen', tipo: 'Pantalla móvil', descripcion: 'Cuatro pasos: iniciar KYC, zona de trabajo, disponibilidad y especialidades (opcional).', ubicacion: 'apps/mobile/src/screens/roles/CleanerOnboardingScreen.tsx', estado: 'hecho' },
    R_SWITCH: { title: 'RoleSwitchButton y AddSecondRoleButton', tipo: 'Componentes móviles', descripcion: 'Cambio instantáneo entre roles y alta del segundo rol para usuarios con un solo rol.', ubicacion: 'apps/mobile/src/screens/roles/RoleSwitchButton.tsx, apps/mobile/src/screens/roles/AddSecondRoleButton.tsx', estado: 'hecho' },
    P_SCREENS: { title: 'Pantallas de perfil', tipo: 'Pantallas móviles', descripcion: 'Perfil propio, edición, perfil público y galería de portafolio con anillo de completitud.', ubicacion: 'apps/mobile/src/screens/profile', estado: 'hecho' },
    P_SETTINGS: { title: 'SettingsScreen y AccountScreen', tipo: 'Pantallas móviles', descripcion: 'Idioma, tema, notificaciones, cambio de correo y clave, y borrado de cuenta con DeleteAccountModal.', ubicacion: 'apps/mobile/src/screens/profile/SettingsScreen.tsx, apps/mobile/src/screens/profile/AccountScreen.tsx', estado: 'hecho' },
    R_CTRL: { title: 'RolesController', tipo: 'Controlador NestJS', descripcion: 'Rutas bajo /users: asignar roles, consultar roles, cambiar rol activo, guardar perfiles de onboarding y consultar su avance.', ubicacion: 'services/api/src/roles/roles.controller.ts', estado: 'hecho' },
    R_SVC: { title: 'RolesService', tipo: 'Servicio NestJS', descripcion: 'La asignación es idempotente, el rol activo debe estar asignado y el onboarding pasa a COMPLETED cuando todos sus pasos están hechos. La autorización usa el arreglo roles, no active_role.', ubicacion: 'services/api/src/roles/roles.service.ts', estado: 'hecho' },
    R_GATE: { title: 'OnboardingGateGuard', tipo: 'Guard NestJS', descripcion: 'Responde 403 «Complete onboarding to access this feature» si el rol exigido con @RequireOnboarding no completó su onboarding. Corre después de JwtAuthGuard.', ubicacion: 'services/api/src/roles/guards/onboarding-gate.guard.ts', estado: 'hecho' },
    R_DB: { title: 'Tablas de roles', tipo: 'Base de datos', descripcion: 'host_profiles y cleaner_profiles (1 a 1 con users, CASCADE) más columnas roles, active_role y onboarding_status_* en users. Índice GiST PostGIS en la zona de trabajo del Cleaner.', tecnologia: 'PostgreSQL + PostGIS', ubicacion: 'services/api/src/roles/entities/host-profile.entity.ts, services/api/src/roles/entities/cleaner-profile.entity.ts', estado: 'hecho' },
    P_CTRL: { title: 'ProfileController', tipo: 'Controlador NestJS', descripcion: 'CRUD de perfil, foto, portafolio, preferencias y operaciones de cuenta bajo /profile.', ubicacion: 'services/api/src/profile/profile.controller.ts', estado: 'hecho' },
    P_SVC: { title: 'ProfileService', tipo: 'Servicio NestJS', descripcion: 'Perfil privado y perfil público con un SELECT dedicado que nunca devuelve campos privados. Los datos comunes están separados de los campos por rol.', ubicacion: 'services/api/src/profile/profile.service.ts', estado: 'hecho' },
    P_PHOTO: { title: 'ProfilePhotoService', tipo: 'Servicio NestJS', descripcion: 'Redimensiona con sharp, cifra con AES-256, guarda en MinIO y entrega URLs firmadas.', tecnologia: 'sharp + MinIO', ubicacion: 'services/api/src/profile/photo/profile-photo.service.ts', estado: 'hecho' },
    P_PORT: { title: 'PortfolioService', tipo: 'Servicio NestJS', descripcion: 'Fotos de portafolio del Cleaner con límite máximo configurable.', ubicacion: 'services/api/src/profile/portfolio/portfolio.service.ts', estado: 'hecho' },
    P_SET: { title: 'SettingsService', tipo: 'Servicio NestJS', descripcion: 'Preferencias en 7 idiomas (en, es, fr, de, it, pt, nl), tema dark, light o system y notificaciones. Se crean al primer acceso.', ubicacion: 'services/api/src/profile/settings/settings.service.ts', estado: 'hecho' },
    P_COMP: { title: 'CompletenessService', tipo: 'Servicio NestJS', descripcion: 'Calcula el porcentaje de perfil con pesos por campo. Valida al arrancar que los pesos sumen 100.', ubicacion: 'services/api/src/profile/completeness/completeness.service.ts', estado: 'hecho' },
    P_ACC: { title: 'AccountService', tipo: 'Servicio NestJS', descripcion: 'Entrega las URLs de Keycloak para cambiar correo y clave (BidClean nunca guarda credenciales) y encola el borrado de cuenta.', ubicacion: 'services/api/src/profile/account/account.service.ts', estado: 'hecho' },
    P_DB: { title: 'Tablas de perfil', tipo: 'Base de datos', descripcion: 'profile_details, user_settings y portfolio_photos. users.email es una copia que se actualiza por webhook de Keycloak.', ubicacion: 'services/api/src/profile/entities', estado: 'hecho' },
    X_MINIO: { title: 'MinIO', tipo: 'Almacenamiento de objetos', descripcion: 'Fotos de perfil y portafolio con URLs firmadas de vida corta.', tecnologia: 'MinIO (S3 compatible)', ubicacion: 'infra/docker-compose.yml', estado: 'hecho' },
    X_KC: { title: 'Keycloak', tipo: 'Proveedor de identidad', descripcion: 'Fuente de verdad del correo y la clave. Envía un webhook a POST /webhooks/keycloak/email al cambiar el correo.', tecnologia: 'Keycloak 25', ubicacion: 'services/api/src/profile/webhooks/keycloak-email.controller.ts', adr: 'ADR-004', estado: 'hecho' },

    D_MODAL: { title: 'DeleteAccountModal', tipo: 'Componente móvil', descripcion: 'Pide escribir una palabra de confirmación (configurable con PROFILE_DELETE_CONFIRMATION_WORD).', ubicacion: 'apps/mobile/src/screens/profile/components/DeleteAccountModal.tsx', estado: 'hecho' },
    D_REQ: { title: 'POST /profile/me/delete-account', tipo: 'Endpoint', descripcion: 'Solicita el borrado. Responde sin esperar el resultado.', ubicacion: 'services/api/src/profile/profile.controller.ts', estado: 'hecho' },
    D_SVC: { title: 'AccountService', tipo: 'Servicio NestJS', descripcion: 'Marca al usuario como DELETION_PENDING y encola el trabajo.', ubicacion: 'services/api/src/profile/account/account.service.ts', estado: 'hecho' },
    D_QUEUE: { title: 'Cola account-deletion', tipo: 'Cola BullMQ', descripcion: 'Reintentos configurables con PROFILE_DELETION_MAX_RETRIES.', tecnologia: 'BullMQ + Redis', ubicacion: 'services/api/src/profile/profile.module.ts', estado: 'hecho' },
    D_JOB: { title: 'DeletionJobProcessor', tipo: 'Worker BullMQ', descripcion: 'Ejecuta la cascada de borrado. Cada paso es idempotente y deja registro de auditoría.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/profile/account/deletion-job.processor.ts', estado: 'hecho' },
    D_S1: { title: 'Cancelar suscripciones', tipo: 'Paso del borrado', descripcion: 'Cancela las suscripciones del usuario en RevenueCat.', tecnologia: 'RevenueCat REST', estado: 'parcial', nota: 'Depende de credenciales de producción de RevenueCat.' },
    D_S2: { title: 'Eliminar usuario en Keycloak', tipo: 'Paso del borrado', descripcion: 'Borra la identidad y las credenciales.', tecnologia: 'Keycloak Admin API', estado: 'hecho' },
    D_S3: { title: 'Eliminar archivos en MinIO', tipo: 'Paso del borrado', descripcion: 'Borra fotos de perfil y portafolio.', tecnologia: 'MinIO', estado: 'hecho' },
    D_S4: { title: 'Anonimizar datos personales', tipo: 'Paso del borrado', descripcion: 'Reemplaza los datos personales por un nombre anónimo y marca la cuenta como DELETED.', estado: 'hecho' },
    D_DONE: { title: 'Cuenta DELETED', tipo: 'Fin', descripcion: 'La cuenta queda anonimizada y sin acceso.', estado: 'hecho' },

    K_DOC: { title: 'DocumentCaptureScreen', tipo: 'Pantalla móvil', descripcion: 'Cámara con marco guía y validación de calidad del documento.', ubicacion: 'apps/mobile/src/screens/kyc/DocumentCaptureScreen.tsx', estado: 'hecho' },
    K_SELFIE: { title: 'SelfieCaptureScreen', tipo: 'Pantalla móvil', descripcion: 'Cámara frontal con superposición facial; exige un único rostro.', ubicacion: 'apps/mobile/src/screens/kyc/SelfieCaptureScreen.tsx', estado: 'hecho' },
    K_STATUS: { title: 'KycStatusScreen', tipo: 'Pantalla móvil', descripcion: 'Muestra pendiente, procesando, verificado o rechazado con reintento. Consulta al servidor mientras está en PROCESSING.', ubicacion: 'apps/mobile/src/screens/kyc/KycStatusScreen.tsx', estado: 'hecho' },
    K_CTRL: { title: 'KycController', tipo: 'Controlador NestJS', descripcion: 'POST /kyc/document, POST /kyc/selfie, GET /kyc/status y POST /kyc/retry. Solo para Cleaners.', ubicacion: 'services/api/src/kyc/kyc.controller.ts', estado: 'hecho' },
    K_SVC: { title: 'KycService', tipo: 'Servicio NestJS', descripcion: 'Coordina subida, estado y reintentos. El reintento crea un registro nuevo (attemptNumber + 1) y respeta KYC_MAX_ATTEMPTS.', ubicacion: 'services/api/src/kyc/kyc.service.ts', estado: 'hecho' },
    K_SM: { title: 'KycStateTransitionService', tipo: 'Máquina de estados', descripcion: 'NOT_STARTED, DOCUMENT_UPLOADED, SELFIE_UPLOADED, PROCESSING, y luego VERIFIED o REJECTED. Solo avanza, con bloqueo pesimista.', ubicacion: 'services/api/src/kyc/state-machine/kyc-state-transition.service.ts', estado: 'hecho' },
    K_STORAGE: { title: 'KycStorageService', tipo: 'Servicio NestJS', descripcion: 'Sube, descarga y borra imágenes cifradas con claves kyc/{userId}/{categoría}/{uuid}.', ubicacion: 'services/api/src/kyc/storage/kyc-storage.service.ts', estado: 'hecho' },
    K_MINIO: { title: 'MinIO (bucket KYC)', tipo: 'Almacenamiento de objetos', descripcion: 'Documentos y selfies cifrados; el bucket se define con KYC_MINIO_BUCKET.', tecnologia: 'MinIO', estado: 'hecho' },
    K_QUEUE: { title: 'Cola de procesamiento KYC', tipo: 'Cola BullMQ', descripcion: 'Procesamiento asíncrono con reintentos y backoff configurables (KYC_PROCESSING_MAX_RETRIES, KYC_PROCESSING_BACKOFF_MS).', tecnologia: 'BullMQ + Redis', ubicacion: 'services/api/src/kyc/jobs/kyc-process.job.ts', estado: 'hecho' },
    K_JOB: { title: 'KycProcessJob', tipo: 'Worker BullMQ', descripcion: 'Pipeline: pasa a PROCESSING, OCR, prueba de vida, comparación facial, coincidencia de nombre y evaluación. Errores 4xx rechazan de inmediato; errores 5xx o de red se reintentan.', ubicacion: 'services/api/src/kyc/jobs/kyc-process.job.ts', estado: 'hecho' },
    K_AICLIENT: { title: 'AiClientService', tipo: 'Cliente HTTP', descripcion: 'Llama al microservicio IA con token de servicio, timeout y reintentos. Define errores tipados de timeout, red y HTTP.', ubicacion: 'services/api/src/kyc/ai-client/ai-client.service.ts', estado: 'hecho' },
    I_OCR: { title: 'POST /ai/ocr', tipo: 'Endpoint FastAPI', descripcion: 'Extrae texto del documento y detecta el rostro con OpenCV.', tecnologia: 'PaddleOCR + OpenCV', ubicacion: 'services/ai/src/kyc/ocr_service.py', estado: 'parcial', nota: 'El microservicio IA aún no está en docker-compose.' },
    I_LIVE: { title: 'POST /ai/liveness', tipo: 'Endpoint FastAPI', descripcion: 'Evalúa que la selfie sea de una persona real.', tecnologia: 'FastAPI', ubicacion: 'services/ai/src/kyc/liveness_service.py', estado: 'parcial', nota: 'El microservicio IA aún no está en docker-compose.' },
    I_FACE: { title: 'POST /ai/face-compare', tipo: 'Endpoint FastAPI', descripcion: 'Compara la selfie con la foto del documento mediante embeddings y similitud coseno.', tecnologia: 'DeepFace (VGG-Face)', ubicacion: 'services/ai/src/kyc/face_compare_service.py', estado: 'parcial', nota: 'El microservicio IA aún no está en docker-compose.' },
    K_NAME: { title: 'Coincidencia de nombre', tipo: 'Cálculo', descripcion: 'Compara el nombre del documento con el del perfil con similitud de Levenshtein (umbral KYC_NAME_MATCH_MIN).', ubicacion: 'services/api/src/kyc/jobs/kyc-process.job.ts', estado: 'hecho' },
    K_EVAL: { title: '¿Puntajes sobre los umbrales?', tipo: 'Decisión', descripcion: 'Evalúa KYC_OCR_CONFIDENCE_THRESHOLD, KYC_FACE_SIMILARITY_THRESHOLD, KYC_LIVENESS_THRESHOLD y KYC_NAME_MATCH_MIN.', estado: 'hecho' },
    K_VERIFIED: { title: 'VERIFIED', tipo: 'Estado final', descripcion: 'El Cleaner puede aceptar ofertas.', estado: 'hecho' },
    K_REJECTED: { title: 'REJECTED', tipo: 'Estado final', descripcion: 'Puede reintentar hasta KYC_MAX_ATTEMPTS; si lo supera recibe 429.', estado: 'hecho' },
    K_RETRY: { title: 'POST /kyc/retry', tipo: 'Endpoint', descripcion: 'Solo si el último intento está REJECTED. Errores: 403 no es Cleaner, 409 ya verificado o no rechazado, 429 máximo de intentos.', ubicacion: 'services/api/src/kyc/kyc.controller.ts', estado: 'hecho' },
    K_PUSH: { title: 'KycNotificationService', tipo: 'Servicio NestJS', descripcion: 'Envía push de verificado o rechazado.', tecnologia: 'OneSignal', ubicacion: 'services/api/src/kyc/kyc-notification.service.ts', estado: 'parcial', nota: 'Faltan credenciales reales de OneSignal.' },
    K_AUDIT: { title: 'KycAuditService', tipo: 'Servicio NestJS', descripcion: 'Registra transiciones, accesos del administrador a imágenes y OCR, decisiones y borrados (cumplimiento GDPR).', ubicacion: 'services/api/src/kyc/kyc-audit.service.ts', estado: 'hecho' },
    K_ADMIN: { title: 'KycAdminController', tipo: 'Controlador NestJS', descripcion: 'Cola de revisión, detalle, imágenes y decisión de aprobar o rechazar. Cada vista queda auditada.', ubicacion: 'services/api/src/kyc/admin/kyc-admin.controller.ts', estado: 'hecho' },
    K_CLEANUP: { title: 'KycCleanupJob', tipo: 'Job programado', descripcion: 'Cron diario a las 3:00 AM que borra imágenes vencidas según KYC_RETENTION_DAYS, en lotes de 50.', ubicacion: 'services/api/src/kyc/jobs/kyc-cleanup.job.ts', estado: 'hecho' },
    K_GUARD: { title: 'KycVerifiedGuard', tipo: 'Guard NestJS', descripcion: 'Si el usuario es Cleaner y su último intento no está VERIFIED responde 403 (kyc.error.not_verified). Los demás roles pasan.', ubicacion: 'services/api/src/kyc/guards/kyc-verified.guard.ts', estado: 'hecho' },
    K_DB: { title: 'Tablas KYC', tipo: 'Base de datos', descripcion: 'kyc_verifications (un registro por intento) y kyc_audit_logs. No existe columna kyc_status en users.', ubicacion: 'services/api/src/kyc/entities', estado: 'hecho' },
  },
  sections: [
    {
      title: 'Endpoints de roles',
      html: `<table>
<thead><tr><th>Método</th><th>Ruta</th><th>Descripción</th></tr></thead>
<tbody>
<tr><td>POST</td><td><code>/users/roles</code></td><td>Asigna uno o ambos roles</td></tr>
<tr><td>GET</td><td><code>/users/me/roles</code></td><td>Roles asignados y rol activo</td></tr>
<tr><td>PATCH</td><td><code>/users/me/active-role</code></td><td>Cambia el rol activo</td></tr>
<tr><td>POST</td><td><code>/users/me/host-profile</code></td><td>Guarda el perfil de onboarding del Host</td></tr>
<tr><td>POST</td><td><code>/users/me/cleaner-profile</code></td><td>Guarda el perfil de onboarding del Cleaner</td></tr>
<tr><td>GET</td><td><code>/users/me/onboarding-status</code></td><td>Avance del onboarding por rol y paso</td></tr>
</tbody></table>`,
    },
    {
      title: 'Endpoints de perfil',
      html: `<table>
<thead><tr><th>Método</th><th>Ruta</th><th>Descripción</th></tr></thead>
<tbody>
<tr><td>GET</td><td><code>/profile/me</code></td><td>Perfil privado completo</td></tr>
<tr><td>PATCH</td><td><code>/profile/me</code></td><td>Campos comunes (nombre, teléfono)</td></tr>
<tr><td>PATCH</td><td><code>/profile/me/host</code></td><td>Campos propios del Host</td></tr>
<tr><td>PATCH</td><td><code>/profile/me/cleaner</code></td><td>Campos propios del Cleaner</td></tr>
<tr><td>POST</td><td><code>/profile/me/photo</code></td><td>Sube la foto de perfil</td></tr>
<tr><td>DELETE</td><td><code>/profile/me/photo</code></td><td>Elimina la foto de perfil</td></tr>
<tr><td>GET</td><td><code>/profile/me/completeness</code></td><td>Porcentaje de completitud</td></tr>
<tr><td>GET</td><td><code>/profile/:userId</code></td><td>Perfil público</td></tr>
<tr><td>POST</td><td><code>/profile/me/portfolio</code></td><td>Sube una foto de portafolio (Cleaner)</td></tr>
<tr><td>DELETE</td><td><code>/profile/me/portfolio/:photoId</code></td><td>Elimina una foto de portafolio</td></tr>
<tr><td>GET</td><td><code>/profile/me/settings</code></td><td>Lee las preferencias</td></tr>
<tr><td>PATCH</td><td><code>/profile/me/settings</code></td><td>Actualiza las preferencias</td></tr>
<tr><td>POST</td><td><code>/profile/me/change-email</code></td><td>URL de Keycloak para cambiar el correo</td></tr>
<tr><td>POST</td><td><code>/profile/me/change-password</code></td><td>URL de Keycloak para cambiar la clave</td></tr>
<tr><td>POST</td><td><code>/profile/me/delete-account</code></td><td>Solicita el borrado asíncrono de la cuenta</td></tr>
<tr><td>POST</td><td><code>/webhooks/keycloak/email</code></td><td>Webhook de Keycloak para sincronizar el correo</td></tr>
</tbody></table>`,
    },
    {
      title: 'Endpoints de KYC',
      html: `<table>
<thead><tr><th>Método</th><th>Ruta</th><th>Descripción</th></tr></thead>
<tbody>
<tr><td>POST</td><td><code>/kyc/document</code></td><td>Sube la imagen del documento (Cleaner)</td></tr>
<tr><td>POST</td><td><code>/kyc/selfie</code></td><td>Sube la selfie y encola el procesamiento</td></tr>
<tr><td>GET</td><td><code>/kyc/status</code></td><td>Estado actual de la verificación</td></tr>
<tr><td>POST</td><td><code>/kyc/retry</code></td><td>Inicia un nuevo intento tras un rechazo</td></tr>
<tr><td>GET</td><td><code>/admin/kyc/queue</code></td><td>Verificaciones pendientes de revisión</td></tr>
<tr><td>GET</td><td><code>/admin/kyc/:id</code></td><td>Detalle completo (registra OCR_VIEWED)</td></tr>
<tr><td>GET</td><td><code>/admin/kyc/:id/document</code></td><td>Imagen del documento (registra DOCUMENT_VIEWED)</td></tr>
<tr><td>GET</td><td><code>/admin/kyc/:id/selfie</code></td><td>Imagen de la selfie (registra SELFIE_VIEWED)</td></tr>
<tr><td>POST</td><td><code>/admin/kyc/:id/decision</code></td><td>Aprueba o rechaza la verificación</td></tr>
</tbody></table>`,
    },
    {
      title: 'Notas',
      html: `<ul>
<li>Specs: <code>.kiro/specs/user-roles</code>, <code>.kiro/specs/user-profile</code> y <code>.kiro/specs/kyc-verification</code> (completados según el ROADMAP).</li>
<li>El microservicio IA expone <code>/ai/ocr</code>, <code>/ai/face-compare</code> y <code>/ai/liveness</code> en <code>services/ai/src/kyc/router.py</code>. Está protegido con token de servicio (<code>AI_SERVICE_AUTH_TOKEN</code>).</li>
<li>El KYC usa PaddleOCR, OpenCV y DeepFace, no AWS Bedrock. No se verificó uso de Bedrock en el flujo KYC.</li>
</ul>`,
    },
  ],
});
