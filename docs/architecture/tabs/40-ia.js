/**
 * 40-ia.js — microservicio de IA (FastAPI): routers, endpoints y motores.
 */
BidCleanArch.registerTab({
  id: 'ia',
  group: 'Plataforma',
  order: 400,
  title: 'Microservicio de IA',
  summary:
    'Servicio FastAPI en services/ai/src con 7 subcarpetas. Cuatro routers están montados (health, kyc, speech, video_verification). '
    + 'Translation, pricing y verification son marcadores sin router. La transcripción responde con NotConfiguredEngine hasta conectar Whisper.',
  diagrams: [
    {
      title: 'Routers, endpoints y motores',
      description: 'La API NestJS llama por HTTP interno. Línea punteada = pendiente o no montado.',
      code: `flowchart LR
  API["API NestJS"]
  MAIN["main.py<br/>FastAPI v0.1.0"]
  MW["Middleware<br/>X-Request-ID"]
  subgraph MONTADOS["Routers montados"]
    R_HEALTH["health"]
    R_KYC["kyc"]
    R_SPEECH["speech"]
    R_VIDEO["video_verification"]
  end
  subgraph SINROUTER["Sin router montado"]
    P_TRANS["translation"]
    P_PRICING["pricing"]
    P_VERIF["verification"]
  end
  subgraph ENDPOINTS["Endpoints"]
    E_HEALTH["GET /health/"]
    E_OCR["POST /ai/ocr"]
    E_FACE["POST /ai/face-compare"]
    E_LIVE["POST /ai/liveness"]
    E_TRANSCRIBE["POST /transcribe"]
    E_VERIFYFACE["POST /verify-face"]
  end
  subgraph MOTORES["Motores"]
    PADDLE["PaddleOCR"]
    DEEPFACE["DeepFace"]
    NOTCONF["NotConfiguredEngine"]
    WHISPER["Whisper.cpp"]
    BEDROCK["AWS Bedrock"]
  end
  API -->|HTTP interno| MAIN
  MAIN --> MW
  MW --> R_HEALTH
  MW --> R_KYC
  MW --> R_SPEECH
  MW --> R_VIDEO
  MAIN -.-> P_TRANS
  MAIN -.-> P_PRICING
  MAIN -.-> P_VERIF
  R_HEALTH --> E_HEALTH
  R_KYC --> E_OCR
  R_KYC --> E_FACE
  R_KYC --> E_LIVE
  R_SPEECH --> E_TRANSCRIBE
  R_VIDEO --> E_VERIFYFACE
  E_OCR --> PADDLE
  E_FACE --> DEEPFACE
  E_LIVE --> DEEPFACE
  E_VERIFYFACE --> DEEPFACE
  E_TRANSCRIBE --> NOTCONF
  NOTCONF -.->|pendiente| WHISPER
  MAIN -.->|sin uso en código| BEDROCK`,
    },
  ],
  nodes: {
    API: { title: 'API NestJS', tipo: 'Cliente del servicio', descripcion: 'Los módulos kyc, chat (notas de voz) y video-verification llaman a este servicio por HTTP interno.', tecnologia: 'NestJS', ubicacion: 'services/api', consume: ['/ai/*', '/transcribe', '/verify-face'], estado: 'hecho' },
    MAIN: { title: 'main.py', tipo: 'Aplicación FastAPI', descripcion: 'Crea la app BidClean AI Service v0.1.0 y monta los routers health, kyc, speech y video_verification. Los include_router de translation y pricing están comentados.', tecnologia: 'FastAPI', ubicacion: 'services/ai/src/main.py', estado: 'parcial', nota: 'No está en docker-compose; se ejecuta con poetry run uvicorn.' },
    MW: { title: 'Middleware X-Request-ID', tipo: 'Middleware', descripcion: 'Propaga el encabezado X-Request-ID entrante o genera un UUID para trazar cada petición.', tecnologia: 'FastAPI middleware', ubicacion: 'services/ai/src/main.py', estado: 'hecho' },
    R_HEALTH: { title: 'Router health', tipo: 'Router', descripcion: 'Liveness del servicio.', ubicacion: 'services/ai/src/health/router.py', estado: 'hecho' },
    R_KYC: { title: 'Router kyc', tipo: 'Router', descripcion: 'OCR de documentos, comparación facial y prueba de vida. Incluye auth, configuración, excepciones y un servicio por capacidad.', ubicacion: 'services/ai/src/kyc', estado: 'hecho' },
    R_SPEECH: { title: 'Router speech', tipo: 'Router', descripcion: 'Transcripción de notas de voz con motor intercambiable (engine.py).', ubicacion: 'services/ai/src/speech', estado: 'parcial', nota: 'El motor por defecto es NotConfiguredEngine.' },
    R_VIDEO: { title: 'Router video_verification', tipo: 'Router', descripcion: 'Verificación facial del Cleaner al llegar a la propiedad.', ubicacion: 'services/ai/src/video_verification', estado: 'hecho' },
    P_TRANS: { title: 'Paquete translation', tipo: 'Marcador', descripcion: 'Paquete vacío. La traducción real la hace LibreTranslate desde la API.', ubicacion: 'services/ai/src/translation', estado: 'falta' },
    P_PRICING: { title: 'Paquete pricing', tipo: 'Marcador', descripcion: 'Paquete vacío, reservado para sugerencia de precios.', ubicacion: 'services/ai/src/pricing', estado: 'falta' },
    P_VERIF: { title: 'Paquete verification', tipo: 'Marcador', descripcion: 'Paquete vacío sin router.', ubicacion: 'services/ai/src/verification', estado: 'falta' },
    E_HEALTH: { title: 'GET /health/', tipo: 'Endpoint', descripcion: 'Estado del servicio.', ubicacion: 'services/ai/src/health/router.py', estado: 'hecho' },
    E_OCR: { title: 'POST /ai/ocr', tipo: 'Endpoint', descripcion: 'Extrae texto del documento de identidad y detecta el rostro.', ubicacion: 'services/ai/src/kyc/ocr_service.py', estado: 'hecho' },
    E_FACE: { title: 'POST /ai/face-compare', tipo: 'Endpoint', descripcion: 'Similitud entre la selfie y el rostro del documento.', ubicacion: 'services/ai/src/kyc/face_compare_service.py', estado: 'hecho' },
    E_LIVE: { title: 'POST /ai/liveness', tipo: 'Endpoint', descripcion: 'Detecta suplantación (spoofing) en la selfie.', ubicacion: 'services/ai/src/kyc/liveness_service.py', estado: 'hecho' },
    E_TRANSCRIBE: { title: 'POST /transcribe', tipo: 'Endpoint', descripcion: 'Transcribe una nota de voz. Hoy responde mediante NotConfiguredEngine.', ubicacion: 'services/ai/src/speech/transcription_service.py', estado: 'parcial', nota: 'Falta conectar Whisper.cpp.' },
    E_VERIFYFACE: { title: 'POST /verify-face', tipo: 'Endpoint', descripcion: 'Compara el rostro del video de llegada con el del perfil verificado.', ubicacion: 'services/ai/src/video_verification/face_verify_service.py', estado: 'hecho' },
    PADDLE: { title: 'PaddleOCR', tipo: 'Motor ML', descripcion: 'Reconocimiento de texto. Está en el grupo opcional ml de Poetry.', tecnologia: 'PaddleOCR + PaddlePaddle', ubicacion: 'services/ai/pyproject.toml', estado: 'hecho' },
    DEEPFACE: { title: 'DeepFace', tipo: 'Motor ML', descripcion: 'Comparación y análisis facial. Grupo opcional ml de Poetry.', tecnologia: 'DeepFace + OpenCV', ubicacion: 'services/ai/pyproject.toml', estado: 'hecho' },
    NOTCONF: { title: 'NotConfiguredEngine', tipo: 'Motor por defecto', descripcion: 'Se devuelve cuando no hay proveedor de voz configurado, por ejemplo en CI. Evita fallar en silencio.', ubicacion: 'services/ai/src/speech/engine.py', estado: 'parcial' },
    WHISPER: { title: 'Whisper.cpp', tipo: 'Motor de voz', descripcion: 'Transcripción en CPU. No está desplegado ni conectado.', tecnologia: 'Whisper.cpp', ubicacion: 'pendiente', estado: 'falta' },
    BEDROCK: { title: 'AWS Bedrock', tipo: 'Servicio externo', descripcion: 'Modelos de IA en la nube. Existen variables AWS_* en .env.example, pero el código de services/ai no lo invoca todavía.', tecnologia: 'AWS Bedrock', ubicacion: '.env.example (AWS_REGION, AWS_ACCESS_KEY_ID)', estado: 'falta', nota: 'Sin integración en código y sin credenciales reales.' },
  },
  sections: [
    {
      title: 'Endpoints',
      html: `<table>
        <tr><th>Método</th><th>Ruta</th><th>Función</th><th>Estado</th></tr>
        <tr><td>GET</td><td><code>/health/</code></td><td>Liveness</td><td>hecho</td></tr>
        <tr><td>POST</td><td><code>/ai/ocr</code></td><td>OCR del documento y detección de rostro</td><td>hecho</td></tr>
        <tr><td>POST</td><td><code>/ai/face-compare</code></td><td>Selfie contra rostro del documento</td><td>hecho</td></tr>
        <tr><td>POST</td><td><code>/ai/liveness</code></td><td>Prueba de vida</td><td>hecho</td></tr>
        <tr><td>POST</td><td><code>/transcribe</code></td><td>Transcripción de notas de voz</td><td>parcial (NotConfiguredEngine)</td></tr>
        <tr><td>POST</td><td><code>/verify-face</code></td><td>Verificación facial de llegada</td><td>hecho</td></tr></table>`,
    },
    {
      title: 'Cómo ejecutarlo (PowerShell)',
      html: '<pre>cd services/ai\npoetry install\npoetry run uvicorn src.main:app --reload --port 8000</pre>',
    },
  ],
});
