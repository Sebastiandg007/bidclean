/**
 * 90-pendientes.js — todo lo que falta para llevar BidClean a producción.
 */
BidCleanArch.registerTab({
  id: 'pendientes',
  group: 'Estado del proyecto',
  order: 900,
  title: 'Lo que falta',
  summary:
    'Componentes y tareas pendientes, agrupados por tipo. Rojo = no existe todavía. Amarillo = el código existe pero falta configuración, '
    + 'credenciales o verificación.',
  diagrams: [
    {
      title: 'Mapa de pendientes',
      description: 'Qué bloquea qué: sin credenciales reales y sin despliegue en el VPS no hay salida a producción.',
      code: `flowchart LR
  PROD(["Salida a producción"])
  subgraph CRED["Credenciales reales"]
    C_STRIPE["Stripe Connect"]
    C_RC["RevenueCat"]
    C_OS["OneSignal"]
    C_AWS["AWS Bedrock"]
    C_MAPBOX["Mapbox sk.*"]
    C_ADMOB["AdMob"]
  end
  subgraph VPS["Despliegue en el VPS"]
    V_COMPOSE["API + IA en docker-compose"]
    V_TRAEFIK["Traefik + SSL"]
    V_LIVEKIT["LiveKit"]
    V_WHISPER["Whisper.cpp"]
    V_PIPER["Piper"]
    V_MON["Prometheus + Grafana + Loki"]
  end
  subgraph SPECS["Specs sin terminar"]
    S_SAMSUNG["Spec 23<br/>samsung-optimization"]
    S_PBT["Spec 25<br/>quality-assurance-pbt"]
    S_ORCH["execution-orchestrator<br/>0/42 tareas"]
  end
  subgraph DEUDA["Deuda técnica"]
    D_AUDIT["full-audit: 65 hallazgos"]
    D_HOOKS["Hooks desactivados"]
    D_APPLE["Apple Sign-In en Keycloak"]
    D_NEWARCH["New Architecture desactivada"]
    D_FLAKY["Test inestable<br/>useThemedStyles"]
    D_SCANNER["config-inventory busca<br/>app.config.ts"]
    D_STUB["Stub obsoleto<br/>expo-image-picker.d.ts"]
  end
  subgraph QA["Verificación"]
    Q_PHONE["APK en celular real"]
    Q_E2E["Flujo E2E con servicios reales"]
  end
  CRED --> PROD
  VPS --> PROD
  QA --> PROD
  V_COMPOSE --> V_TRAEFIK
  V_WHISPER --> C_AWS
  C_STRIPE --> Q_E2E
  V_COMPOSE --> Q_E2E
  SPECS -.-> PROD
  DEUDA -.-> PROD`,
    },
  ],
  nodes: {
    PROD: { title: 'Salida a producción', tipo: 'Meta', descripcion: 'Dominio bidclean.tech con todos los servicios en el VPS (8 núcleos, 32 GB).', estado: 'falta' },
    C_STRIPE: { title: 'Credenciales Stripe', tipo: 'Credencial', descripcion: 'STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET y cuenta Connect. Sin ellas no hay cobro ni liberación.', ubicacion: '.env.example', estado: 'parcial' },
    C_RC: { title: 'Credenciales RevenueCat', tipo: 'Credencial', descripcion: 'Llaves de producción para iOS/Android y secreto de webhook.', ubicacion: '.env.example', estado: 'parcial' },
    C_OS: { title: 'Credenciales OneSignal', tipo: 'Credencial', descripcion: 'App ID y REST API key para enviar push.', ubicacion: '.env.example', estado: 'parcial' },
    C_AWS: { title: 'Credenciales AWS Bedrock', tipo: 'Credencial', descripcion: 'Acceso IAM con permisos mínimos para Bedrock.', ubicacion: '.env.example', estado: 'parcial' },
    C_MAPBOX: { title: 'Token Mapbox sk.*', tipo: 'Credencial', descripcion: 'Token secreto de descarga del SDK nativo para builds de producción.', ubicacion: 'EAS env MAPBOX_DOWNLOAD_TOKEN', estado: 'parcial' },
    C_ADMOB: { title: 'AdMob', tipo: 'Credencial', descripcion: 'IDs de app y de bloques de anuncios para usuarios gratuitos.', ubicacion: 'apps/mobile/src/screens/ads', estado: 'parcial' },
    V_COMPOSE: { title: 'API e IA en docker-compose', tipo: 'Infraestructura', descripcion: 'Hoy docker-compose solo tiene postgres, redis, minio, keycloak, centrifugo y libretranslate.', ubicacion: 'infra/docker-compose.yml', estado: 'falta' },
    V_TRAEFIK: { title: 'Traefik + SSL', tipo: 'Infraestructura', descripcion: 'Reverse proxy con Let\'s Encrypt para api., ws., rtc., storage., auth.bidclean.tech.', estado: 'falta' },
    V_LIVEKIT: { title: 'LiveKit', tipo: 'Infraestructura', descripcion: 'Servidor de VoIP y video. El código de la API ya emite los tokens de sala.', ubicacion: 'services/api/src/chat/voip', estado: 'falta' },
    V_WHISPER: { title: 'Whisper.cpp', tipo: 'Infraestructura', descripcion: 'El endpoint /transcribe responde NotConfiguredEngine hasta conectar Whisper.', ubicacion: 'services/ai/src/speech', estado: 'falta' },
    V_PIPER: { title: 'Piper', tipo: 'Infraestructura', descripcion: 'Texto a voz en CPU.', estado: 'falta' },
    V_MON: { title: 'Monitoreo', tipo: 'Infraestructura', descripcion: 'Prometheus, Grafana y Loki; Sentry para errores.', estado: 'falta' },
    S_SAMSUNG: { title: 'Spec 23 samsung-optimization', tipo: 'Spec', descripcion: 'Optimizaciones para dispositivos Samsung Galaxy (One UI, DeX, S Pen).', ubicacion: '.kiro/specs/samsung-optimization', estado: 'falta' },
    S_PBT: { title: 'Spec 25 quality-assurance-pbt', tipo: 'Spec', descripcion: 'Batería de tests basados en propiedades sobre las reglas de negocio.', ubicacion: '.kiro/specs/quality-assurance-pbt', estado: 'falta' },
    S_ORCH: { title: 'execution-orchestrator', tipo: 'Spec', descripcion: 'Orquestador de ejecución de specs. En borrador, 0 de 42 tareas.', ubicacion: '.kiro/specs/execution-orchestrator', estado: 'falta' },
    D_AUDIT: { title: 'Hallazgos del full-audit', tipo: 'Deuda técnica', descripcion: '65 hallazgos abiertos del auditor de componentes.', ubicacion: 'tools/full-audit', estado: 'parcial' },
    D_HOOKS: { title: 'Hooks desactivados', tipo: 'Proceso', descripcion: 'Los hooks de Kiro están en .disabled y falta update-docs-on-change. Se dejan así por decisión del dueño.', ubicacion: '.kiro/hooks', estado: 'parcial' },
    D_APPLE: { title: 'Apple Sign-In', tipo: 'Deuda técnica', descripcion: 'Falta configurar el proveedor Apple en Keycloak.', ubicacion: 'infra/keycloak', estado: 'parcial' },
    D_NEWARCH: { title: 'New Architecture', tipo: 'Deuda técnica', descripcion: 'La New Architecture de React Native está desactivada en el build.', ubicacion: 'apps/mobile/app.config.js', estado: 'parcial' },
    D_FLAKY: { title: 'Test inestable', tipo: 'Calidad', descripcion: 'useThemedStyles.spec.tsx a veces supera el timeout bajo carga.', ubicacion: 'apps/mobile/src/theme', estado: 'parcial' },
    D_SCANNER: { title: 'Escáner de config-inventory', tipo: 'Herramienta', descripcion: 'application-scanner.ts busca app.config.ts, pero el archivo real es app.config.js.', ubicacion: 'tools/config-inventory', estado: 'parcial' },
    D_STUB: { title: 'Stub expo-image-picker', tipo: 'Limpieza', descripcion: 'Declaración de tipos que ya no hace falta.', ubicacion: 'apps/mobile/src/types/expo-image-picker.d.ts', estado: 'parcial' },
    Q_PHONE: { title: 'APK en celular real', tipo: 'Verificación', descripcion: 'Build #13 listo. En el emulador falló por gráficos (EGL), sin errores JS. Falta probar en un teléfono.', ubicacion: 'expo.dev → builds', estado: 'parcial' },
    Q_E2E: { title: 'Flujo E2E real', tipo: 'Verificación', descripcion: 'Recorrer publicación → pago → cierre con Stripe en modo test y todos los servicios levantados.', estado: 'falta' },
  },
  sections: [
    {
      title: 'Prioridad sugerida',
      html: `<ol>
        <li>Probar el APK en un celular real.</li>
        <li>Agregar API e IA a docker-compose y desplegar en el VPS con Traefik.</li>
        <li>Cargar credenciales de Stripe en modo test y recorrer el flujo E2E.</li>
        <li>Desplegar LiveKit, Whisper y Piper.</li>
        <li>Credenciales de producción (Stripe, RevenueCat, OneSignal, AWS, AdMob) y monitoreo.</li>
        <li>Specs 23 y 25, deuda técnica y hallazgos del full-audit.</li></ol>`,
    },
  ],
});
