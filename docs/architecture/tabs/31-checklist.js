/**
 * 31-checklist.js — checklist de limpieza con fotos antes y después: ejecución del trabajo, subida firmada a MinIO y evento checklist_completed.
 */
BidCleanArch.registerTab({
  id: 'checklist',
  group: 'Ejecución del servicio',
  order: 310,
  title: 'Checklist con fotos',
  summary:
    'Registra <b>el trabajo en sí</b> mientras la sesión está <code>IN_PROGRESS</code>: el Cleaner recorre el checklist de la propiedad, marca tareas y adjunta fotos de antes y después. '
    + 'La corrida se crea al drenar el evento durable <code>service_started</code> (checkpoint propio <code>consumer_name = checklist</code>); el checklist y las políticas se congelan como snapshot en ese momento, así que editar la propiedad después no afecta una corrida en curso. '
    + 'Las fotos van directo a un bucket privado de MinIO con concesiones de un solo uso; nunca pasan por la API ni por PostgreSQL. '
    + 'Al finalizar emite <code>checklist_completed</code>, el hecho que consumen Cierre y Disputas. Este módulo nunca libera escrow, resuelve disputas ni califica. '
    + 'Estado: backend y app implementados; la captura real de fotos necesita dispositivo físico y MinIO activo.',
  diagrams: [
    {
      title: 'De service_started a checklist_completed',
      description: 'El consumidor crea la corrida con el snapshot que viaja en el evento. Cada foto reserva un cupo, sube por URL firmada y se finaliza con re-inspección del servidor; el cierre emite el evento por outbox.',
      code: `flowchart TB
  SERV_OB_C[("service_outbox<br/>service_started con snapshot")]
  CONS_C["ChecklistStartedConsumer<br/>checkpoint consumer_name checklist"]
  MAPEA_C["started-payload.mapper<br/>JSONB no confiable a StartedPayload"]
  CREA_C["ChecklistRunCreationService<br/>createFromStarted idempotente"]
  RUN_C[("checklist_runs<br/>ACTIVE, COMPLETED, ABANDONED")]
  TAREA_C[("checklist_tasks<br/>orden, hecho, foto requerida")]
  FOTO_C[("checklist_task_photos<br/>referencias, no bytes")]
  subgraph SG_APP_C["App del Cleaner"]
    PANT_C["ChecklistScreen<br/>tareas y fotos"]
    PROG_C["ChecklistProgressScreen<br/>avance y evidencias"]
    CAPTURA_C["usePhotoCapture<br/>cámara y galería"]
    TAREA_FILA["TaskRow<br/>marcar hecho"]
  end
  subgraph SG_API_C["API · ChecklistPhotosModule"]
    CTRL_C["ChecklistController<br/>/service-sessions/:id/checklist"]
    SVC_TAREA["ChecklistTaskService<br/>marca tarea con invariante de conteo"]
    SVC_FOTO["ChecklistPhotoService<br/>requestUpload, finalizeUpload, playback"]
    SVC_RUN["ChecklistRunService<br/>finalize, abandono, reconciliación"]
    GRANT_C[("checklist_upload_grants<br/>cupo y concesión únicos")]
    STORE_C["ChecklistStorageService<br/>presign PUT y GET, inspección"]
  end
  MINIO_C[("MinIO<br/>bucket checklist-photos")]
  OB_C[("checklist_outbox<br/>misma transacción que COMPLETED")]
  EVT_CHK["checklist_completed<br/>resumen y completedAt autoritativo"]
  SIGUE_C["Cierre y Disputas<br/>consumidores con checkpoint propio"]
  ESCUCHA_C["OfferTerminalChecklistListener<br/>fuerza ABANDONED"]

  SERV_OB_C --> CONS_C
  CONS_C --> MAPEA_C
  MAPEA_C --> CREA_C
  CREA_C --> RUN_C
  CREA_C --> TAREA_C
  PANT_C --> TAREA_FILA
  PANT_C --> CAPTURA_C
  PROG_C --> CTRL_C
  TAREA_FILA -->|POST tasks taskId| CTRL_C
  CAPTURA_C -->|POST photo request-upload| CTRL_C
  CTRL_C --> SVC_TAREA
  CTRL_C --> SVC_FOTO
  CTRL_C --> SVC_RUN
  SVC_TAREA --> TAREA_C
  SVC_FOTO -->|reserva cupo atómica| GRANT_C
  SVC_FOTO --> STORE_C
  STORE_C -->|URL firmada| CAPTURA_C
  CAPTURA_C -->|PUT directo de la foto| MINIO_C
  CAPTURA_C -->|POST photo finalize| CTRL_C
  STORE_C -->|inspecciona tamaño y tipo| MINIO_C
  SVC_FOTO --> FOTO_C
  SVC_RUN -->|precondición cumplida| RUN_C
  SVC_RUN --> OB_C
  OB_C --> EVT_CHK
  EVT_CHK --> SIGUE_C
  ESCUCHA_C -->|oferta terminal| SVC_RUN`,
    },
    {
      title: 'Estados de la corrida y trabajos de mantenimiento',
      description: 'La corrida es de un solo ganador. Cuatro procesos acotan el ciclo: corridas atascadas, concesiones obsoletas, retención de fotos y lápidas de objetos.',
      code: `flowchart LR
  ACTIVA_C["ACTIVE<br/>tareas editables"]
  PRECOND_C{"¿Se cumple la precondición<br/>de finalización?"}
  COMPLETA_C(["COMPLETED<br/>emite checklist_completed"])
  ABANDONA_C(["ABANDONED<br/>oferta terminal o atasco"])
  J_ATASCO_C["StuckRunSweepProcessor<br/>respaldo si se perdió la señal"]
  J_GRANT_C["StaleUploadGrantCleanupProcessor<br/>cierra concesiones y borra huérfanos"]
  J_RETEN_C["RetentionCleanupProcessor<br/>borra fotos vencidas"]
  J_TOMBA_C["TombstoneDrainProcessor<br/>borra claves liberadas"]
  TOMBA_C[("checklist_photo_object_deletions<br/>lápidas pendientes")]

  ACTIVA_C -->|POST finalize| PRECOND_C
  PRECOND_C -->|no| ACTIVA_C
  PRECOND_C -->|sí| COMPLETA_C
  ACTIVA_C -->|offer terminal| ABANDONA_C
  J_ATASCO_C -->|umbral de atasco| ABANDONA_C
  J_GRANT_C -->|concesiones ISSUED vencidas| ACTIVA_C
  J_RETEN_C -->|CASCADE y lápida| TOMBA_C
  J_TOMBA_C -->|lee lápidas| TOMBA_C`,
    },
  ],
  nodes: {
    SERV_OB_C: { title: 'service_outbox · service_started', tipo: 'Tabla outbox', descripcion: 'El evento service_started (tab Seguimiento) transporta el snapshot del checklist y de las políticas vigentes en el instante de IN_PROGRESS.', ubicacion: 'services/api/src/service-tracking/service-outbox.ts', produce: ['service_started'], adr: 'ADR-015', estado: 'hecho' },
    CONS_C: { title: 'ChecklistStartedConsumer', tipo: 'Consumidor de eventos', descripcion: 'Drena service_started bajo consumer_name = checklist con el checkpoint compartido de service_outbox. Nunca llamada síncrona ni polling. Intervalo y lote por CHECKLIST_STARTED_DRAIN_*.', tecnologia: '@nestjs/schedule', ubicacion: 'services/api/src/checklist-photos/consumers/checklist-started.consumer.ts', consume: ['service_started'], estado: 'hecho' },
    MAPEA_C: { title: 'started-payload.mapper', tipo: 'Utilidad', descripcion: 'Convierte el JSONB no confiable del evento en un StartedPayload tipado antes de crear la corrida.', ubicacion: 'services/api/src/checklist-photos/consumers/started-payload.mapper.ts', estado: 'hecho' },
    CREA_C: { title: 'ChecklistRunCreationService', tipo: 'Servicio NestJS', descripcion: 'createFromStarted idempotente con snapshot llevado por el evento: cambios posteriores en la propiedad o la configuración no revalidan una corrida en curso.', ubicacion: 'services/api/src/checklist-photos/service/checklist-run-creation.service.ts', estado: 'hecho' },
    RUN_C: { title: 'checklist_runs', tipo: 'Tabla PostgreSQL', descripcion: 'Una corrida por sesión. completed_at se sella en la misma transacción de ACTIVE a COMPLETED y es el reloj autoritativo para el Cierre.', tecnologia: 'PostgreSQL', ubicacion: 'services/api/src/checklist-photos/entities/checklist-run.entity.ts', adr: 'ADR-017', estado: 'hecho' },
    TAREA_C: { title: 'checklist_tasks', tipo: 'Tabla PostgreSQL', descripcion: 'Tareas ordenadas copiadas del snapshot, con marca de hecho y requisito de foto según CHECKLIST_PHOTO_REQUIRED_POLICY.', tecnologia: 'PostgreSQL', ubicacion: 'services/api/src/checklist-photos/entities/checklist-task.entity.ts', estado: 'hecho' },
    FOTO_C: { title: 'checklist_task_photos', tipo: 'Tabla PostgreSQL', descripcion: 'Referencias a las fotos finalizadas (tipo antes o después). Los bytes viven solo en MinIO. Máximo por tarea con CHECKLIST_PHOTO_MAX_PER_TASK.', tecnologia: 'PostgreSQL', ubicacion: 'services/api/src/checklist-photos/entities/checklist-task-photo.entity.ts', estado: 'hecho' },
    PANT_C: { title: 'ChecklistScreen', tipo: 'Pantalla móvil', descripcion: 'Lista de tareas del Cleaner con acciones para marcar y adjuntar fotos; usa checklist.store y checklist.api.', ubicacion: 'apps/mobile/src/screens/checklist/ChecklistScreen.tsx', estado: 'hecho' },
    PROG_C: { title: 'ChecklistProgressScreen', tipo: 'Pantalla móvil', descripcion: 'Vista de avance con ProgressBar y miniaturas EvidenceThumb; el Host puede ver la evidencia con URLs de reproducción acotadas a la sesión.', ubicacion: 'apps/mobile/src/screens/checklist/ChecklistProgressScreen.tsx', estado: 'hecho' },
    CAPTURA_C: { title: 'usePhotoCapture', tipo: 'Hook móvil', descripcion: 'Pide la URL firmada, sube la foto directo a MinIO y finaliza.', tecnologia: 'expo-image-picker', ubicacion: 'apps/mobile/src/screens/checklist/usePhotoCapture.ts', estado: 'parcial', nota: 'La captura real requiere dispositivo físico; solo está cubierta con mocks.' },
    TAREA_FILA: { title: 'TaskRow', tipo: 'Componente móvil', descripcion: 'Fila de tarea con interruptor de hecho y acceso a la foto.', ubicacion: 'apps/mobile/src/screens/checklist/components/TaskRow.tsx', estado: 'hecho' },
    CTRL_C: { title: 'ChecklistController', tipo: 'Controlador NestJS', descripcion: 'Rutas anidadas bajo service-sessions/:id/checklist con JWT y ValidationPipe estricto. Un no participante recibe 403 y no aprende nada de la corrida.', ubicacion: 'services/api/src/checklist-photos/checklist.controller.ts', estado: 'hecho' },
    SVC_TAREA: { title: 'ChecklistTaskService', tipo: 'Servicio NestJS', descripcion: 'Solo el Cleaner, con la corrida ACTIVE y la sesión IN_PROGRESS. Mantiene el invariante del conteo de tareas hechas.', ubicacion: 'services/api/src/checklist-photos/service/checklist-task.service.ts', estado: 'hecho' },
    SVC_FOTO: { title: 'ChecklistPhotoService', tipo: 'Servicio NestJS', descripcion: 'requestUpload reserva el cupo de forma atómica, finalizeUpload corre bajo el bloqueo de la corrida y getPlaybackUrl solo sirve fotos de la misma sesión.', ubicacion: 'services/api/src/checklist-photos/service/checklist-photo.service.ts', estado: 'hecho' },
    SVC_RUN: { title: 'ChecklistRunService', tipo: 'Servicio NestJS', descripcion: 'finalize verifica la precondición (NONE, ALL_TASKS_DONE o ALL_REQUIRED_PHOTOS), pasa a COMPLETED y escribe el outbox en la misma transacción. También forceAbandon y getChecklist.', ubicacion: 'services/api/src/checklist-photos/service/checklist-run.service.ts', produce: ['checklist_completed'], estado: 'hecho' },
    GRANT_C: { title: 'checklist_upload_grants', tipo: 'Tabla PostgreSQL', descripcion: 'Concesión de un solo uso persistida antes de emitir la URL (ISSUED, CONSUMED, EXPIRED, CANCELLED). La llave del objeto no es la credencial.', tecnologia: 'PostgreSQL', ubicacion: 'services/api/src/checklist-photos/entities/checklist-upload-grant.entity.ts', estado: 'hecho' },
    STORE_C: { title: 'ChecklistStorageService', tipo: 'Servicio de almacenamiento', descripcion: 'Firma PUT y GET con TTL configurable, inspecciona el objeto real y borra de forma idempotente.', tecnologia: 'MinIO (S3)', ubicacion: 'services/api/src/checklist-photos/storage/checklist-storage.service.ts', estado: 'hecho' },
    MINIO_C: { title: 'MinIO · checklist-photos', tipo: 'Almacenamiento de objetos', descripcion: 'Bucket privado. Subida con URL firmada PUT directa desde el teléfono; lectura solo con URL firmada GET de corta duración.', tecnologia: 'MinIO', ubicacion: 'infra/docker', estado: 'externo' },
    OB_C: { title: 'checklist_outbox', tipo: 'Tabla outbox', descripcion: 'Fila checklist_completed escrita en la misma transacción que la transición a COMPLETED. Es el único evento del módulo.', ubicacion: 'services/api/src/checklist-photos/entities/checklist-outbox.entity.ts', produce: ['checklist_completed'], estado: 'hecho' },
    EVT_CHK: { title: 'checklist_completed', tipo: 'Evento de dominio', descripcion: 'Resumen durable sin PII ni bytes: tareas completadas y completedAt autoritativo (campo aditivo que exige el Cierre).', ubicacion: 'services/api/src/checklist-photos/checklist.types.ts', produce: ['checklist_completed'], estado: 'hecho' },
    SIGUE_C: { title: 'Cierre y Disputas', tipo: 'Consumidores aguas abajo', descripcion: 'service-completion (consumer_name = completion) y dispute-system leen checklist_completed con checkpoints propios; Disputas usa las referencias como evidencia.', ubicacion: 'services/api/src/service-completion/repository/checklist-outbox-consumer.checkpoint.ts', consume: ['checklist_completed'], estado: 'hecho' },
    ESCUCHA_C: { title: 'OfferTerminalChecklistListener', tipo: 'Listener de eventos', descripcion: 'Con @OnEvent fuerza ABANDONED cuando la oferta llega a un estado terminal.', ubicacion: 'services/api/src/checklist-photos/listeners/offer-terminal-checklist.listener.ts', consume: ['offer terminal'], estado: 'hecho' },
    ACTIVA_C: { title: 'ACTIVE', tipo: 'Estado', descripcion: 'Corrida abierta: se pueden marcar tareas y subir fotos.', estado: 'hecho' },
    PRECOND_C: { title: '¿Precondición de finalización?', tipo: 'Decisión', descripcion: 'Según CHECKLIST_COMPLETION_PRECONDITION: ninguna, todas las tareas hechas o todas las fotos requeridas presentes.', ubicacion: 'services/api/src/checklist-photos/service/checklist-run.service.ts', estado: 'hecho' },
    COMPLETA_C: { title: 'COMPLETED', tipo: 'Estado terminal', descripcion: 'Corrida finalizada; emite checklist_completed.', produce: ['checklist_completed'], estado: 'hecho' },
    ABANDONA_C: { title: 'ABANDONED', tipo: 'Estado terminal', descripcion: 'La oferta terminó o el barrido detectó una corrida atascada.', estado: 'hecho' },
    J_ATASCO_C: { title: 'StuckRunSweepProcessor', tipo: 'Worker BullMQ', descripcion: 'Respaldo que abandona corridas cuando se perdió la señal terminal (umbral CHECKLIST_STUCK_RUN_THRESHOLD_MS).', tecnologia: 'BullMQ', ubicacion: 'services/api/src/checklist-photos/jobs/stuck-run-sweep.processor.ts', estado: 'hecho' },
    J_GRANT_C: { title: 'StaleUploadGrantCleanupProcessor', tipo: 'Worker BullMQ', descripcion: 'Borra objetos huérfanos y cierra concesiones ISSUED obsoletas, liberando el cupo de la tarea.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/checklist-photos/jobs/stale-upload-grant-cleanup.processor.ts', estado: 'hecho' },
    J_RETEN_C: { title: 'RetentionCleanupProcessor', tipo: 'Worker BullMQ', descripcion: 'Borra de forma definitiva las fotos pasado CHECKLIST_PHOTO_RETENTION_DAYS.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/checklist-photos/jobs/retention-cleanup.processor.ts', estado: 'hecho' },
    J_TOMBA_C: { title: 'TombstoneDrainProcessor', tipo: 'Worker BullMQ', descripcion: 'Elimina de MinIO las claves liberadas tras el CASCADE.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/checklist-photos/jobs/tombstone-drain.processor.ts', estado: 'hecho' },
    TOMBA_C: { title: 'checklist_photo_object_deletions', tipo: 'Tabla PostgreSQL', descripcion: 'Lápidas de claves de objeto pendientes, para que borrar filas no deje fotos huérfanas en MinIO.', tecnologia: 'PostgreSQL', ubicacion: 'services/api/src/checklist-photos/entities/checklist-photo-object-deletion.entity.ts', estado: 'hecho' },
  },
  sections: [
    {
      title: 'Endpoints de checklist',
      html: `<table>
<thead><tr><th>Método</th><th>Ruta</th><th>Descripción</th></tr></thead>
<tbody>
<tr><td>GET</td><td><code>/service-sessions/:id/checklist</code></td><td>Reconciliación para participantes: corrida, tareas ordenadas y referencias de fotos (ids, no llaves).</td></tr>
<tr><td>POST</td><td><code>/service-sessions/:id/checklist/tasks/:taskId</code></td><td>El Cleaner marca una tarea { done } con la corrida ACTIVE y la sesión IN_PROGRESS.</td></tr>
<tr><td>POST</td><td><code>/service-sessions/:id/checklist/tasks/:taskId/photo/request-upload</code></td><td>Reserva cupo y concesión; devuelve { objectKey, uploadUrl, expiresAt }.</td></tr>
<tr><td>POST</td><td><code>/service-sessions/:id/checklist/tasks/:taskId/photo/finalize</code></td><td>Finaliza la foto subida con { objectKey, kind }; el servidor la re-inspecciona.</td></tr>
<tr><td>GET</td><td><code>/service-sessions/:id/checklist/photos/:photoId/playback-url</code></td><td>URL firmada de lectura, acotada a la sesión y a participantes.</td></tr>
<tr><td>POST</td><td><code>/service-sessions/:id/checklist/finalize</code></td><td>Cierra la corrida si se cumple la precondición y emite checklist_completed.</td></tr>
</tbody></table>`,
    },
    {
      title: 'Configuración',
      html: `<p>Bloque <code>CHECKLIST_*</code> validado al arrancar por <code>validateChecklistPhotosConfig()</code> (omitido con NODE_ENV=test): bucket, tamaño máximo, tipos MIME, fotos por tarea, TTL de subida, concesión y reproducción, retención en días, política de fotos requeridas, precondición de finalización, intervalos y lotes de barrido y limpieza. Se reutilizan las variables <code>MINIO_*</code>.</p>`,
    },
  ],
});
