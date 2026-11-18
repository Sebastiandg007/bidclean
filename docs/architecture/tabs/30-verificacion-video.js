/**
 * 30-verificacion-video.js — verificación de identidad por video al llegar: grabación, subida a MinIO, comparación facial asíncrona con DeepFace y resultado consultivo.
 */
BidCleanArch.registerTab({
  id: 'verificacion-video',
  group: 'Ejecución del servicio',
  order: 300,
  title: 'Verificación por video',
  summary:
    'Cuando la geocerca confirma la llegada (<code>service_arrived</code>), el Cleaner graba un clip corto y un worker asíncrono compara su rostro con la selfie KYC ya verificada. '
    + 'El resultado es <b>consultivo</b>: nunca bloquea el servicio, no retiene el escrow ni cambia el KYC. El Host solo ve una clasificación derivada, nunca el puntaje crudo ni el video. '
    + 'El video vive 24 a 48 h en un bucket privado de MinIO (el reloj de retención parte en <code>uploaded_at</code>) y no existe ruta de reproducción. '
    + 'PostgreSQL es la fuente de verdad; la subida exige una concesión de un solo uso y el servidor re-inspecciona el objeto real. '
    + 'Estado: backend, servicio de IA y app implementados; las pruebas con DeepFace real y la notificación push del resultado dependen de infraestructura externa.',
  diagrams: [
    {
      title: 'De la llegada al resultado de la comparación',
      description: 'El consumidor crea la verificación al drenar service_arrived. El Cleaner pide una concesión, sube directo a MinIO y finaliza; el worker lee el video y la selfie KYC, llama a la IA y escribe el resultado con su evento.',
      code: `flowchart TB
  SERV_OB[("service_outbox<br/>service_arrived")]
  CONS_V["VerificationArrivalConsumer<br/>checkpoint consumer_name video"]
  CREA_V["VerificationCreationService<br/>createFromArrival idempotente"]
  SES_V[("verification_sessions<br/>estado y decisión")]
  subgraph SG_APP_V["App móvil"]
    PANT_V["ArrivalVerificationScreen<br/>grabar y enviar"]
    GRABA_V["useArrivalRecorder<br/>cámara frontal y límite de duración"]
    INDIC_V["ArrivalVerificationIndicator<br/>clasificación para el Host"]
  end
  subgraph SG_API_V["API · VideoVerificationModule"]
    CTRL_V["VideoVerificationController<br/>/video-verifications"]
    SVC_V["VerificationService<br/>request-upload, finalize, reconcile"]
    GRANT_V[("video_verification_upload_grants<br/>concesión de un solo uso")]
    STORE_V["VerificationStorageService<br/>presign PUT e inspección"]
    DURA_V["VideoDurationProbe<br/>duración real ISO-BMFF y WebM"]
  end
  MINIO_V[("MinIO<br/>bucket verification-videos")]
  COLA_V["Cola BullMQ<br/>video-face-comparison"]
  PROC_V["FaceComparisonProcessor<br/>begin, comparar, resultado protegido"]
  KYC_V["KycReferenceReader<br/>selfie KYC VERIFIED solo lectura"]
  CLIENTE_IA["FaceVerifyClient<br/>envía bytes, reintento acotado"]
  IA_V["IA FastAPI<br/>POST /verify-face con DeepFace"]
  OB_V[("verification_outbox<br/>misma transacción que el resultado")]
  EVT_COMP["verification_completed<br/>MATCH, NO_MATCH, INCONCLUSIVE"]
  EVT_FLAG["verification_flagged<br/>NO_MATCH o INCONCLUSIVE"]
  PUSH_V["Notificaciones push<br/>consumidor de verification_outbox"]

  SERV_OB --> CONS_V
  CONS_V --> CREA_V
  CREA_V -->|PENDING_UPLOAD o DISABLED| SES_V
  PANT_V --> GRABA_V
  PANT_V -->|POST request-upload| CTRL_V
  CTRL_V --> SVC_V
  SVC_V -->|concesión antes de la URL| GRANT_V
  SVC_V --> STORE_V
  STORE_V -->|URL firmada de subida| PANT_V
  GRABA_V -->|PUT directo del video| MINIO_V
  PANT_V -->|POST finalize| CTRL_V
  SVC_V -->|inspecciona tamaño y tipo reales| STORE_V
  STORE_V --> DURA_V
  STORE_V --> MINIO_V
  SVC_V -->|UPLOADED y encola trabajo| COLA_V
  COLA_V --> PROC_V
  PROC_V -->|lee el video| MINIO_V
  PROC_V --> KYC_V
  PROC_V --> CLIENTE_IA
  CLIENTE_IA --> IA_V
  PROC_V -->|decisión y evento en 1 tx| SES_V
  PROC_V --> OB_V
  OB_V --> EVT_COMP
  OB_V --> EVT_FLAG
  EVT_COMP --> PUSH_V
  EVT_FLAG --> PUSH_V
  CTRL_V -->|GET reconciliación| INDIC_V`,
    },
    {
      title: 'Estados de la verificación y trabajos de mantenimiento',
      description: 'Transiciones de un solo ganador. Cuatro procesos de fondo acotan el ciclo: ventana de subida, atascos, retención del video y limpieza de objetos huérfanos.',
      code: `flowchart LR
  PEND_UP["PENDING_UPLOAD<br/>esperando el video"]
  SUBIDO["UPLOADED<br/>objeto validado por el servidor"]
  PROCESA["PROCESSING<br/>comparación en curso"]
  DECIDIDO(["MATCH, NO_MATCH o INCONCLUSIVE<br/>decisión con umbral snapshot"])
  FALLO(["FAILED<br/>reintentos agotados"])
  VENCIDO(["EXPIRED<br/>nunca subió"])
  APAGADO(["DISABLED<br/>interruptor general apagado"])
  J_VENTANA["UploadWindowSweepProcessor<br/>PENDING_UPLOAD a EXPIRED"]
  J_ATASCO["StuckProcessingSweepProcessor<br/>re-encola o falla"]
  J_RETEN["RetentionCleanupProcessor<br/>borra video pasada la retención"]
  J_TOMBA["TombstoneDrainProcessor<br/>borra objetos liberados"]
  TOMBA_V[("video_verification_object_deletions<br/>lápidas pendientes")]

  PEND_UP -->|finalize válido| SUBIDO
  SUBIDO -->|beginProcessing| PROCESA
  PROCESA -->|resultado protegido| DECIDIDO
  PROCESA -->|máximo de intentos| FALLO
  PEND_UP -->|ventana vencida| VENCIDO
  J_VENTANA --> VENCIDO
  J_ATASCO -->|retryProcessing| PROCESA
  J_ATASCO --> FALLO
  J_RETEN -->|CASCADE y lápida| TOMBA_V
  J_TOMBA -->|lee lápidas| TOMBA_V
  APAGADO -.->|sin concesión ni video| PEND_UP`,
    },
  ],
  nodes: {
    SERV_OB: { title: 'service_outbox · service_arrived', tipo: 'Tabla outbox', descripcion: 'Evento de llegada confirmado por la geocerca del servidor (tab Seguimiento). Este módulo lo lee con su propio checkpoint para no interferir con otros consumidores.', ubicacion: 'services/api/src/service-tracking/service-outbox.ts', produce: ['service_arrived'], adr: 'ADR-015', estado: 'hecho' },
    CONS_V: { title: 'VerificationArrivalConsumer', tipo: 'Consumidor de eventos', descripcion: 'Drena service_arrived bajo consumer_name = video reutilizando el checkpoint compartido. Intervalo y lote configurables (VIDEO_VERIFICATION_ARRIVAL_DRAIN_*, 5 s y 100 por defecto).', tecnologia: '@nestjs/schedule', ubicacion: 'services/api/src/video-verification/consumers/verification-arrival.consumer.ts', consume: ['service_arrived'], estado: 'hecho' },
    CREA_V: { title: 'VerificationCreationService', tipo: 'Servicio NestJS', descripcion: 'createFromArrival es idempotente: crea la verificación en PENDING_UPLOAD, o en DISABLED si VIDEO_VERIFICATION_ENABLED es falso (privacidad por diseño: sin concesión, sin video, sin trabajo).', ubicacion: 'services/api/src/video-verification/service/verification-creation.service.ts', estado: 'hecho' },
    SES_V: { title: 'verification_sessions', tipo: 'Tabla PostgreSQL', descripcion: 'Una verificación por sesión de servicio. Guarda estado, decisión, puntaje interno (nunca expuesto crudo), umbral snapshot y uploaded_at, que arranca el reloj de retención.', tecnologia: 'PostgreSQL', ubicacion: 'services/api/src/video-verification/entities/verification-session.entity.ts', adr: 'ADR-016', estado: 'hecho' },
    PANT_V: { title: 'ArrivalVerificationScreen', tipo: 'Pantalla móvil', descripcion: 'Flujo del Cleaner: grabar el clip, pedir la URL de subida, subir y finalizar. Muestra el resultado con ResultBadge y el botón RecordButton.', ubicacion: 'apps/mobile/src/screens/verification/ArrivalVerificationScreen.tsx', estado: 'hecho' },
    GRABA_V: { title: 'useArrivalRecorder', tipo: 'Hook móvil', descripcion: 'Gestiona permisos de cámara, grabación y límite de duración. La API y el store viven en verification.api.ts y verification.store.ts.', tecnologia: 'expo-camera', ubicacion: 'apps/mobile/src/screens/verification/useArrivalRecorder.ts', estado: 'parcial', nota: 'La grabación real requiere dispositivo físico; solo está cubierta con mocks.' },
    INDIC_V: { title: 'ArrivalVerificationIndicator', tipo: 'Componente móvil', descripcion: 'Indicador que consulta GET /video-verifications/:id y muestra la clasificación derivada. Nunca muestra puntaje crudo ni video.', ubicacion: 'apps/mobile/src/screens/verification/ArrivalVerificationIndicator.tsx', estado: 'hecho' },
    CTRL_V: { title: 'VideoVerificationController', tipo: 'Controlador NestJS', descripcion: 'Tres rutas con JWT: consulta, solicitud de subida y finalización. No existe ruta de reproducción ni descarga del video.', ubicacion: 'services/api/src/video-verification/video-verification.controller.ts', estado: 'hecho' },
    SVC_V: { title: 'VerificationService', tipo: 'Servicio NestJS', descripcion: 'requestUpload (concesión primero), finalizeUpload (autoridad del servidor, un solo ganador) y reconciliación. Verifica rol Cleaner y participación.', ubicacion: 'services/api/src/video-verification/service/verification.service.ts', estado: 'hecho' },
    GRANT_V: { title: 'video_verification_upload_grants', tipo: 'Tabla PostgreSQL', descripcion: 'Concesión de un solo uso que liga object_key, sesión y Cleaner. La llave no es la credencial. TTL VIDEO_VERIFICATION_UPLOAD_GRANT_TTL_SECONDS (600 s).', tecnologia: 'PostgreSQL', ubicacion: 'services/api/src/video-verification/entities/video-verification-upload-grant.entity.ts', estado: 'hecho' },
    STORE_V: { title: 'VerificationStorageService', tipo: 'Servicio de almacenamiento', descripcion: 'Firma PUT, inspecciona tamaño, tipo y duración reales del objeto, lo lee y lo borra. No emite URL de reproducción.', tecnologia: 'MinIO (S3)', ubicacion: 'services/api/src/video-verification/storage/verification-storage.service.ts', estado: 'hecho' },
    DURA_V: { title: 'VideoDurationProbe', tipo: 'Utilidad', descripcion: 'Mide la duración autoritativa del clip leyendo contenedores ISO-BMFF y Matroska/WebM. Límite VIDEO_VERIFICATION_MAX_DURATION_MS (15 s).', ubicacion: 'services/api/src/video-verification/storage/video-duration.probe.ts', estado: 'hecho' },
    MINIO_V: { title: 'MinIO · verification-videos', tipo: 'Almacenamiento de objetos', descripcion: 'Bucket privado con cifrado del lado del servidor y sin lectura pública. Tamaño máximo 15 MB; tipos mp4, quicktime y webm.', tecnologia: 'MinIO', ubicacion: 'infra/docker', adr: 'ADR-016', estado: 'externo' },
    COLA_V: { title: 'Cola video-face-comparison', tipo: 'Cola BullMQ', descripcion: 'Trabajo compare-arrival-face con reintentos exponenciales (3 intentos, base 5 s). Los trabajos fallidos se conservan para inspección.', tecnologia: 'BullMQ + Redis', ubicacion: 'services/api/src/video-verification/video-verification.constants.ts', estado: 'hecho' },
    PROC_V: { title: 'FaceComparisonProcessor', tipo: 'Worker BullMQ', descripcion: 'beginProcessing atómico, lee video y selfie, compara y escribe el resultado con writeResultGuarded. Re-deriva la decisión contra el umbral snapshot (0.6 por defecto).', tecnologia: 'BullMQ', ubicacion: 'services/api/src/video-verification/jobs/face-comparison.processor.ts', estado: 'hecho' },
    KYC_V: { title: 'KycReferenceReader', tipo: 'Utilidad de lectura', descripcion: 'Resuelve y lee la selfie KYC en estado VERIFIED del bucket de KYC. Solo lectura; nunca modifica el KYC.', ubicacion: 'services/api/src/video-verification/storage/kyc-reference-reader.ts', estado: 'hecho' },
    CLIENTE_IA: { title: 'FaceVerifyClient', tipo: 'Cliente HTTP', descripcion: 'axios con token de servicio AI_SERVICE_AUTH_TOKEN. Opción A: envía bytes, no referencias a almacenamiento. Timeout 60 s y reintento acotado.', tecnologia: 'axios', ubicacion: 'services/api/src/video-verification/ai-client/face-verify.client.ts', estado: 'hecho' },
    IA_V: { title: 'IA · POST /verify-face', tipo: 'Microservicio FastAPI', descripcion: 'Recibe multipart candidate y reference, extrae un fotograma con OpenCV y compara embeddings con DeepFace. Devuelve similitud y decisión consultiva. Sin credenciales de almacenamiento; los embeddings no se guardan.', tecnologia: 'FastAPI + DeepFace + OpenCV', ubicacion: 'services/ai/src/video_verification/router.py', estado: 'parcial', nota: 'Las pruebas con modelos DeepFace reales dependen del entorno con los pesos descargados.' },
    OB_V: { title: 'verification_outbox', tipo: 'Tabla outbox', descripcion: 'Solo emite eventos con decisión: MATCH, NO_MATCH e INCONCLUSIVE. FAILED, EXPIRED y DISABLED no emiten nada. Ids determinísticos evento:verificationId.', ubicacion: 'services/api/src/video-verification/verification-outbox.ts', produce: ['verification_completed', 'verification_flagged'], estado: 'hecho' },
    EVT_COMP: { title: 'verification_completed', tipo: 'Evento de dominio', descripcion: 'Payload mínimo: verificationId, serviceSessionId, decision y score (solo para deduplicar; nunca se muestra crudo al Host).', ubicacion: 'services/api/src/video-verification/verification-outbox.ts', produce: ['verification_completed'], estado: 'hecho' },
    EVT_FLAG: { title: 'verification_flagged', tipo: 'Evento de dominio', descripcion: 'Se agrega a verification_completed cuando la decisión es NO_MATCH o INCONCLUSIVE, para alertar sin bloquear el servicio.', ubicacion: 'services/api/src/video-verification/verification-outbox.ts', produce: ['verification_flagged'], estado: 'hecho' },
    PUSH_V: { title: 'Notificaciones push', tipo: 'Consumidor externo al módulo', descripcion: 'El módulo de notificaciones debe consumir verification_outbox con su propio checkpoint.', ubicacion: 'services/api/src/notifications', consume: ['verification_completed', 'verification_flagged'], estado: 'parcial', nota: 'Falta confirmar el mapper de verification_outbox en NotificationsModule; OneSignal exige llaves reales.' },
    PEND_UP: { title: 'PENDING_UPLOAD', tipo: 'Estado', descripcion: 'Verificación creada, esperando que el Cleaner suba el clip dentro de la ventana (VIDEO_VERIFICATION_UPLOAD_WINDOW_MS, 15 min).', estado: 'hecho' },
    SUBIDO: { title: 'UPLOADED', tipo: 'Estado', descripcion: 'El servidor inspeccionó el objeto (tamaño, tipo y duración) y encoló la comparación.', estado: 'hecho' },
    PROCESA: { title: 'PROCESSING', tipo: 'Estado', descripcion: 'Comparación en curso. Si se atasca más de 10 min el barrido la re-encola.', estado: 'hecho' },
    DECIDIDO: { title: 'Decisión terminal', tipo: 'Estado terminal', descripcion: 'MATCH, NO_MATCH o INCONCLUSIVE, clasificada con el umbral snapshot de esa verificación. Es consultiva.', estado: 'hecho' },
    FALLO: { title: 'FAILED', tipo: 'Estado terminal', descripcion: 'Se agotaron los reintentos de comparación (VIDEO_VERIFICATION_MAX_RETRIES). No emite evento ni bloquea el servicio.', estado: 'hecho' },
    VENCIDO: { title: 'EXPIRED', tipo: 'Estado terminal', descripcion: 'La ventana de subida venció sin video.', estado: 'hecho' },
    APAGADO: { title: 'DISABLED', tipo: 'Estado terminal', descripcion: 'VIDEO_VERIFICATION_ENABLED = false: no hay concesión, video ni trabajo.', estado: 'hecho' },
    J_VENTANA: { title: 'UploadWindowSweepProcessor', tipo: 'Worker BullMQ', descripcion: 'Barrido acotado e idempotente: PENDING_UPLOAD pasa a EXPIRED al vencer la ventana.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/video-verification/jobs/upload-window-sweep.processor.ts', estado: 'hecho' },
    J_ATASCO: { title: 'StuckProcessingSweepProcessor', tipo: 'Worker BullMQ', descripcion: 'Re-encola UPLOADED y PROCESSING atascados (umbral 10 min) y los pasa a FAILED tras el máximo de intentos.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/video-verification/jobs/stuck-processing-sweep.processor.ts', estado: 'hecho' },
    J_RETEN: { title: 'RetentionCleanupProcessor', tipo: 'Worker BullMQ', descripcion: 'Borra de forma definitiva el video pasado el horizonte (48 h desde uploaded_at).', tecnologia: 'BullMQ', ubicacion: 'services/api/src/video-verification/jobs/retention-cleanup.processor.ts', estado: 'hecho' },
    J_TOMBA: { title: 'TombstoneDrainProcessor', tipo: 'Worker BullMQ', descripcion: 'Elimina de MinIO los objetos liberados tras el CASCADE y marca la lápida como DONE.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/video-verification/jobs/tombstone-drain.processor.ts', estado: 'hecho' },
    TOMBA_V: { title: 'video_verification_object_deletions', tipo: 'Tabla PostgreSQL', descripcion: 'Lápidas de claves de objeto pendientes de borrar, para que ninguna fila eliminada deje el video huérfano en MinIO.', tecnologia: 'PostgreSQL', ubicacion: 'services/api/src/video-verification/entities/video-verification-object-deletion.entity.ts', estado: 'hecho' },
  },
  sections: [
    {
      title: 'Endpoints de video-verifications',
      html: `<table>
<thead><tr><th>Método</th><th>Ruta</th><th>Descripción</th></tr></thead>
<tbody>
<tr><td>GET</td><td><code>/video-verifications/:id</code></td><td>Estado autoritativo y clasificación derivada para participantes (nunca puntaje ni URL).</td></tr>
<tr><td>POST</td><td><code>/video-verifications/:id/request-upload</code></td><td>Solo Cleaner y en PENDING_UPLOAD: guarda la concesión y devuelve { objectKey, uploadUrl, expiresAt }.</td></tr>
<tr><td>POST</td><td><code>/video-verifications/:id/finalize</code></td><td>Solo Cleaner con concesión: el servidor inspecciona el objeto, pasa a UPLOADED y encola la comparación.</td></tr>
<tr><td>POST</td><td><code>/verify-face</code></td><td>Servicio de IA (interno): multipart candidate y reference, con token de servicio.</td></tr>
</tbody></table>`,
    },
    {
      title: 'Límites conocidos',
      html: `<ul>
<li>Resultado <b>consultivo</b>: una comparación baja, fallida, deshabilitada o que nunca corrió no bloquea el servicio.</li>
<li>No es prueba de vida certificada (REQ-VV11) y existe una carrera conocida entre finalize y MinIO documentada en ADR-016.</li>
<li>Variables <code>VIDEO_VERIFICATION_*</code> validadas al arrancar; se reutilizan <code>MINIO_*</code>, <code>KYC_MINIO_BUCKET</code> y <code>AI_SERVICE_AUTH_TOKEN</code>.</li>
</ul>`,
    },
  ],
});
