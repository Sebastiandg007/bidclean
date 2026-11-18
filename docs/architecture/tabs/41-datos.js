/**
 * 41-datos.js — PostgreSQL + PostGIS por contexto, outbox, Redis y buckets de MinIO.
 */
BidCleanArch.registerTab({
  id: 'datos',
  group: 'Plataforma',
  order: 410,
  title: 'Datos y almacenamiento',
  summary:
    'Una sola base PostgreSQL con PostGIS, tablas agrupadas por contexto de negocio (cada módulo es dueño de sus tablas). '
    + 'Los eventos de dominio pasan por tablas outbox. Redis sostiene las colas BullMQ. MinIO guarda archivos en siete buckets privados.',
  diagrams: [
    {
      title: 'Tablas por contexto',
      description: 'Cada contexto referencia a los demás solo por id. Las migraciones están en services/api/src/migrations.',
      code: `flowchart TB
  MIGR["Migraciones TypeORM<br/>33 archivos"]
  PG[("PostgreSQL 16<br/>+ PostGIS")]
  subgraph CONTEXTOS["Contextos de negocio"]
    DB_IDENT["Identidad<br/>users, auth_sessions, biometric_*,<br/>kyc_*, cleaner_profiles, host_profiles,<br/>profile_details, user_settings, portfolio_photos"]
    DB_MERCADO["Mercado<br/>properties, property_photos, offers,<br/>offer_state_transitions, offer_deliveries,<br/>negotiation_*, favorites"]
    DB_DINERO["Dinero<br/>payments, payment_attempts, payment_events,<br/>stripe_accounts, commission_rules,<br/>commission_rule_audit, subscriptions"]
    DB_COM["Comunicación<br/>chat_conversations, chat_messages,<br/>chat_voice_notes, voip_calls,<br/>notifications, notification_devices"]
    DB_SERVICIO["Ejecución del servicio<br/>service_sessions, checklist_runs,<br/>verification_sessions, service_completions,<br/>service_ratings, release_intents, disputes"]
  end
  subgraph OUTBOXES["Tablas outbox"]
    OB_DOM["offer_outbox, payment_outbox,<br/>negotiation_outbox, chat_outbox,<br/>voip_outbox"]
    OB_SERVICE["service_outbox<br/>service_outbox_consumers"]
    OB_CHECK["checklist_outbox"]
    OB_VERIF["verification_outbox"]
    OB_COMPL["completion_outbox"]
    OB_DISP["dispute_outbox"]
  end
  MIGR --> PG
  PG --- DB_IDENT
  PG --- DB_MERCADO
  PG --- DB_DINERO
  PG --- DB_COM
  PG --- DB_SERVICIO
  DB_MERCADO --> OB_DOM
  DB_DINERO --> OB_DOM
  DB_COM --> OB_DOM
  DB_SERVICIO --> OB_SERVICE
  DB_SERVICIO --> OB_CHECK
  DB_SERVICIO --> OB_VERIF
  DB_SERVICIO --> OB_COMPL
  DB_SERVICIO --> OB_DISP`,
    },
    {
      title: 'Redis, BullMQ y MinIO',
      description: 'Los workers consumen outbox y colas; los archivos viajan por URLs firmadas a buckets privados.',
      code: `flowchart LR
  API["API NestJS"]
  WORKERS["Workers"]
  REDIS[("Redis 7")]
  BULLMQ["Colas BullMQ<br/>16 colas"]
  MINIO[("MinIO<br/>puertos 9000 y 9001")]
  B_KYC["kyc-documents"]
  B_PROFILE["profile-photos"]
  B_PROPERTY["property-photos"]
  B_VOICE["chat-voice-notes"]
  B_VIDEO["verification-videos"]
  B_CHECK["checklist-photos"]
  B_DISPUTE["dispute-evidence"]
  API --> REDIS
  REDIS --- BULLMQ
  BULLMQ --> WORKERS
  API -->|URLs firmadas| MINIO
  WORKERS -->|limpieza de objetos| MINIO
  MINIO --- B_KYC
  MINIO --- B_PROFILE
  MINIO --- B_PROPERTY
  MINIO --- B_VOICE
  MINIO --- B_VIDEO
  MINIO --- B_CHECK
  MINIO --- B_DISPUTE`,
    },
  ],
  nodes: {
    MIGR: { title: 'Migraciones', tipo: 'Esquema', descripcion: 'Una migración por cambio de esquema, con up y down. Numeradas desde 1700000000000 hasta 1700000046000.', tecnologia: 'TypeORM migrations', ubicacion: 'services/api/src/migrations', estado: 'hecho' },
    PG: { title: 'PostgreSQL + PostGIS', tipo: 'Base de datos', descripcion: 'Llaves UUID, timestamps con zona horaria, consultas de radio con PostGIS.', tecnologia: 'postgis/postgis:16-3.4', ubicacion: 'infra/docker-compose.yml, puerto 15432', estado: 'hecho' },
    DB_IDENT: { title: 'Contexto Identidad', tipo: 'Tablas', descripcion: 'users, auth_sessions, biometric_challenges, biometric_credentials, kyc_verifications, kyc_audit_logs, cleaner_profiles, host_profiles, profile_details, user_settings, portfolio_photos.', ubicacion: 'auth, kyc, roles, profile', estado: 'hecho' },
    DB_MERCADO: { title: 'Contexto Mercado', tipo: 'Tablas', descripcion: 'properties, property_photos, offers, offer_state_transitions, offer_deliveries, negotiation_threads, negotiation_proposals, favorites.', ubicacion: 'properties, offers, negotiation, favorites', estado: 'hecho' },
    DB_DINERO: { title: 'Contexto Dinero', tipo: 'Tablas', descripcion: 'payments, payment_attempts, payment_events, stripe_accounts, commission_rules, commission_rule_audit, subscriptions, subscription_events.', ubicacion: 'payments, commission, subscriptions', estado: 'hecho' },
    DB_COM: { title: 'Contexto Comunicación', tipo: 'Tablas', descripcion: 'chat_conversations, chat_messages, chat_voice_notes, voice_note_upload_grants, voice_note_object_deletions, voip_calls, notifications, notification_devices, notification_preferences, onesignal_webhook_events.', ubicacion: 'chat, notifications', estado: 'hecho' },
    DB_SERVICIO: { title: 'Contexto Ejecución del servicio', tipo: 'Tablas', descripcion: 'service_sessions, checklist_runs, checklist_tasks, checklist_task_photos, verification_sessions, service_completions, service_ratings, release_intents, disputes, dispute_evidence y tablas de grants y borrado de objetos.', ubicacion: 'service-tracking, checklist-photos, video-verification, service-completion, dispute-system', estado: 'hecho' },
    OB_DOM: { title: 'Outbox de dominio', tipo: 'Outbox', descripcion: 'Cinco outbox definidos en una sola entidad compartida: offer_outbox, payment_outbox, negotiation_outbox, chat_outbox y voip_outbox. Los eventos se escriben en la misma transacción del cambio.', ubicacion: 'services/api/src/notifications/entities/outbox.entity.ts', estado: 'hecho' },
    OB_SERVICE: { title: 'Outbox de seguimiento', tipo: 'Outbox', descripcion: 'service_outbox más service_outbox_consumers y service_activation_consumed para consumo idempotente.', ubicacion: 'services/api/src/service-tracking/entities', estado: 'hecho' },
    OB_CHECK: { title: 'checklist_outbox', tipo: 'Outbox', descripcion: 'Eventos del checklist, por ejemplo checklist_completed.', ubicacion: 'services/api/src/checklist-photos/entities', estado: 'hecho' },
    OB_VERIF: { title: 'verification_outbox', tipo: 'Outbox', descripcion: 'Eventos de la verificación por video.', ubicacion: 'services/api/src/video-verification/entities', estado: 'hecho' },
    OB_COMPL: { title: 'completion_outbox', tipo: 'Outbox', descripcion: 'Eventos de cierre del servicio, por ejemplo service_confirmed.', ubicacion: 'services/api/src/service-completion/entities', estado: 'hecho' },
    OB_DISP: { title: 'dispute_outbox', tipo: 'Outbox', descripcion: 'Eventos de disputas.', ubicacion: 'services/api/src/dispute-system/entities', estado: 'hecho' },
    API: { title: 'API NestJS', tipo: 'Backend', descripcion: 'Encola trabajos y emite URLs firmadas de subida y descarga.', ubicacion: 'services/api', estado: 'hecho' },
    WORKERS: { title: 'Workers', tipo: 'Procesamiento asíncrono', descripcion: 'Procesan colas, despachan outbox y borran objetos huérfanos.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/*/', estado: 'hecho' },
    REDIS: { title: 'Redis', tipo: 'Cache y colas', descripcion: 'Backend de BullMQ y cache.', tecnologia: 'redis:7-alpine', ubicacion: 'infra/docker-compose.yml, puerto 16379', estado: 'hecho' },
    BULLMQ: { title: 'Colas BullMQ', tipo: 'Colas', descripcion: 'Dieciséis colas: radio, entrega, webhooks, notificaciones, transcripción, liberación de pagos, disputas y más.', tecnologia: 'BullMQ', ubicacion: 'services/api/src', estado: 'hecho' },
    MINIO: { title: 'MinIO', tipo: 'Almacenamiento de objetos', descripcion: 'Compatible con S3. Imagen cloudpirates/image-minio porque MinIO retiró sus imágenes públicas.', tecnologia: 'MinIO', ubicacion: 'infra/docker-compose.yml', estado: 'hecho' },
    B_KYC: { title: 'Bucket kyc-documents', tipo: 'Bucket', descripcion: 'Documentos y selfies del KYC. Variable KYC_MINIO_BUCKET.', ubicacion: '.env.example', estado: 'hecho' },
    B_PROFILE: { title: 'Bucket profile-photos', tipo: 'Bucket', descripcion: 'Avatares y portafolio. Variable MINIO_PROFILE_PHOTOS_BUCKET.', ubicacion: '.env.example', estado: 'hecho' },
    B_PROPERTY: { title: 'Bucket property-photos', tipo: 'Bucket', descripcion: 'Fotos de propiedades. Variable MINIO_PROPERTY_PHOTOS_BUCKET.', ubicacion: '.env.example', estado: 'hecho' },
    B_VOICE: { title: 'Bucket chat-voice-notes', tipo: 'Bucket', descripcion: 'Audio de notas de voz, privado y sin lectura pública. Variable MINIO_VOICE_NOTES_BUCKET.', ubicacion: 'services/api/src/chat/voice/voice.constants.ts', estado: 'hecho' },
    B_VIDEO: { title: 'Bucket verification-videos', tipo: 'Bucket', descripcion: 'Videos de llegada. Variable VIDEO_VERIFICATION_MINIO_BUCKET.', ubicacion: '.env.example', estado: 'hecho' },
    B_CHECK: { title: 'Bucket checklist-photos', tipo: 'Bucket', descripcion: 'Fotos de evidencia del checklist. Variable CHECKLIST_PHOTO_MINIO_BUCKET.', ubicacion: 'services/api/src/checklist-photos/checklist.constants.ts', estado: 'hecho' },
    B_DISPUTE: { title: 'Bucket dispute-evidence', tipo: 'Bucket', descripcion: 'Fotos de evidencia de disputas. Variable DISPUTE_EVIDENCE_MINIO_BUCKET.', ubicacion: 'services/api/src/dispute-system/dispute.constants.ts', estado: 'hecho' },
  },
  sections: [
    {
      title: 'Convenciones de base de datos',
      html: `<ul>
        <li>Llaves primarias UUID v4, nombres en snake_case, tablas en plural.</li>
        <li>Estados como VARCHAR validado en la aplicación, no ENUM de PostgreSQL.</li>
        <li>El servicio de IA no tiene credenciales de MinIO: recibe los archivos desde la API.</li></ul>`,
    },
  ],
});
