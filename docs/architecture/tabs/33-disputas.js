/**
 * 33-disputas.js — sistema de disputas: caso, evidencia, resolución y acción financiera (reembolso o liberación) mediante intenciones durables hacia el escrow.
 */
BidCleanArch.registerTab({
  id: 'disputas',
  group: 'Ejecución del servicio',
  order: 330,
  title: 'Disputas',
  summary:
    'Dueño del <b>caso de disputa y su resolución</b>, nunca del libro contable. El caso nace de <code>service_disputed</code> (el Cierre lo enruta; no existe <code>POST /disputes</code>), se reúne evidencia a partir de hechos durables del servicio y se llega a <code>FAVOR_CLEANER</code>, <code>FAVOR_HOST</code> o <code>PARTIAL</code>. '
    + 'La resolución genera una <b>intención financiera durable</b> que un worker ejecuta contra el escrow de Pagos: liberar, reembolso total o reembolso parcial. Este módulo no tiene llaves ni SDK de Stripe. '
    + 'Garantías: el escrow permanece en <code>OPEN</code> hasta que Pagos aplica la acción (<b>clear-escrow-LAST</b>), resolver y vencimiento por SLA son de un solo ganador y, por pago, a lo sumo un efecto financiero de disputa. '
    + 'Estado: backend y app implementados; los efectos reales de reembolso y liberación dependen de Stripe con llaves reales.',
  diagrams: [
    {
      title: 'Del caso a la acción financiera',
      description: 'Dos intenciones durables: una bloquea el escrow (OPEN, luego NONE) y otra ejecuta la acción financiera. Ambas sobreviven al caso (dispute_id ON DELETE SET NULL) y los workers operan por payment_id.',
      code: `flowchart TB
  COMP_OB[("completion_outbox<br/>service_disputed")]
  CONS_D["DisputeCreatedConsumer<br/>checkpoint consumer_name dispute"]
  CREA_D["DisputeCreationService<br/>createFromRouting, fase desde payout_status"]
  DISP_T[("disputes<br/>estado, fase, resolución")]
  ESC_INT_T[("dispute_escrow_intents<br/>OPEN y luego NONE")]
  ESC_WORKER["EscrowIntentWorker<br/>setDisputeStatus por payment_id"]
  CLIENTE_ESC["EscrowClient<br/>único puente hacia Pagos"]
  PAGOS_D["Pagos · DisputeService y DisputeSettlementService<br/>autoridad del dinero"]
  subgraph SG_APP_D["App móvil"]
    HOST_D["DisputeHostScreen<br/>motivo y evidencia"]
    CLEAN_D["DisputeCleanerScreen<br/>respuesta y evidencia"]
    SUBE_D["EvidenceUploader<br/>foto desde galería"]
    GALERIA_D["EvidenceGallery<br/>evidencia del caso"]
    RESUM_D["OutcomeSummary<br/>resultado y cuenta regresiva"]
  end
  subgraph SG_API_D["API · DisputeSystemModule"]
    CTRL_D["DisputeController<br/>/disputes"]
    VISTA_D["DisputeViewService<br/>sin campos internos de intención"]
    EVID_D["DisputeEvidenceService<br/>concesión, finalize, estructurada"]
    UPSTREAM_D["UpstreamEvidenceReader<br/>refs de checklist, video y llegada"]
    LIFE_D["DisputeLifecycleService<br/>resolve solo del resolver"]
    RES_D["DisputeResolutionService<br/>resolución a intención financiera"]
    MAPEO_D["resolution-mapping<br/>función pura"]
  end
  MINIO_D[("MinIO<br/>bucket de evidencia")]
  FIN_INT_T[("dispute_financial_intents<br/>PENDING a ACCEPTED")]
  FIN_WORKER["FinancialIntentWorker<br/>refund o release, clear-escrow-LAST"]
  DEC_ACCION{"¿Qué resolución<br/>se aplica?"}
  LIBERA_D["RELEASE<br/>FAVOR_CLEANER libera los fondos"]
  REEMB_TOTAL["FULL_REFUND<br/>FAVOR_HOST reembolso total"]
  REEMB_PARC["PARTIAL_REFUND<br/>PARTIAL con tope aplicado por Pagos"]
  BLOQ_D(["ACTION_BLOCKED<br/>requiere revisión, escrow sigue OPEN"])
  LIMPIA_D["setDisputeStatus NONE<br/>se limpia al final"]
  OB_D[("dispute_outbox<br/>misma transacción que la transición")]
  EVT_OP["dispute_opened"]
  EVT_RES["dispute_resolved"]

  COMP_OB --> CONS_D
  CONS_D --> CREA_D
  CREA_D -->|caso activo idempotente| DISP_T
  CREA_D -->|intención OPEN en 1 tx| ESC_INT_T
  CREA_D --> OB_D
  ESC_INT_T --> ESC_WORKER
  ESC_WORKER --> CLIENTE_ESC
  CLIENTE_ESC --> PAGOS_D
  HOST_D --> SUBE_D
  CLEAN_D --> SUBE_D
  HOST_D --> GALERIA_D
  HOST_D --> RESUM_D
  SUBE_D -->|request-upload y finalize| CTRL_D
  HOST_D -->|GET y evidence| CTRL_D
  CTRL_D --> VISTA_D
  CTRL_D --> EVID_D
  EVID_D --> UPSTREAM_D
  SUBE_D -->|PUT directo| MINIO_D
  EVID_D -->|inspecciona el objeto| MINIO_D
  CTRL_D -->|POST resolve| LIFE_D
  LIFE_D --> RES_D
  RES_D --> MAPEO_D
  MAPEO_D --> DEC_ACCION
  DEC_ACCION -->|FAVOR_CLEANER| LIBERA_D
  DEC_ACCION -->|FAVOR_HOST| REEMB_TOTAL
  DEC_ACCION -->|PARTIAL| REEMB_PARC
  LIBERA_D --> FIN_INT_T
  REEMB_TOTAL --> FIN_INT_T
  REEMB_PARC --> FIN_INT_T
  LIFE_D --> OB_D
  OB_D --> EVT_OP
  OB_D --> EVT_RES
  FIN_INT_T --> FIN_WORKER
  FIN_WORKER --> CLIENTE_ESC
  PAGOS_D -->|APPLIED, CEILING_CLAMPED o NO_OP| LIMPIA_D
  PAGOS_D -->|BLOCKED| BLOQ_D
  LIMPIA_D --> ESC_INT_T`,
    },
    {
      title: 'Ciclo de vida del caso y trabajos de mantenimiento',
      description: 'La resolución manual y el vencimiento por SLA compiten por una única transición terminal. Los procesos de fondo cierran concesiones obsoletas, borran evidencia de casos terminales y vacían lápidas.',
      code: `flowchart LR
  ABIERTA["OPEN<br/>caso creado, ventana de evidencia"]
  REVISION["UNDER_REVIEW<br/>en revisión del resolver"]
  GANA{"¿Primero el resolver<br/>o el SLA?"}
  RESUELTA(["RESOLVED<br/>FAVOR_CLEANER, FAVOR_HOST o PARTIAL"])
  VENCIDA(["EXPIRED<br/>resolución de respaldo del SLA"])
  SLA_J["DisputeSlaSweepProcessor<br/>barrido acotado de casos vencidos"]
  SLA_SVC["DisputeSlaService<br/>expireDue con resolución de respaldo"]
  RETEN_J["EvidenceRetentionProcessor<br/>solo casos terminales"]
  GRANT_J["StaleGrantCleanupProcessor<br/>huérfanos y concesiones ISSUED obsoletas"]
  TOMBA_J["TombstoneDrainProcessor<br/>claves HOST_PHOTO liberadas"]
  TOMBA_D[("dispute_object_deletions<br/>lápidas pendientes")]
  UNICA_FIN["Una sola intención financiera<br/>uq_dispute_financial_intent_dispute"]

  ABIERTA --> REVISION
  ABIERTA --> GANA
  REVISION --> GANA
  GANA -->|resolver| RESUELTA
  GANA -->|SLA| VENCIDA
  SLA_J --> SLA_SVC
  SLA_SVC --> GANA
  RESUELTA --> UNICA_FIN
  VENCIDA --> UNICA_FIN
  RESUELTA --> RETEN_J
  VENCIDA --> RETEN_J
  RETEN_J -->|CASCADE y lápida| TOMBA_D
  GRANT_J -->|concesiones vencidas| ABIERTA
  TOMBA_J -->|lee lápidas| TOMBA_D`,
    },
  ],
  nodes: {
    COMP_OB: { title: 'completion_outbox · service_disputed', tipo: 'Tabla outbox', descripcion: 'Evento emitido por el Cierre cuando el Host disputa antes o después de la liberación. Es el único disparador del caso.', ubicacion: 'services/api/src/service-completion/completion-outbox.ts', produce: ['service_disputed'], estado: 'hecho' },
    CONS_D: { title: 'DisputeCreatedConsumer', tipo: 'Consumidor de eventos', descripcion: 'Drena service_disputed con el checkpoint completion_outbox_consumers (consumer_name = dispute). Intervalo y lote por DISPUTE_CREATION_DRAIN_*.', tecnologia: '@nestjs/schedule', ubicacion: 'services/api/src/dispute-system/consumers/dispute-created.consumer.ts', consume: ['service_disputed'], estado: 'hecho' },
    CREA_D: { title: 'DisputeCreationService', tipo: 'Servicio NestJS', descripcion: 'createFromRouting idempotente. Determina la fase (PRE_RELEASE o POST_RELEASE) desde payout_status de Pagos y escribe la intención de escrow OPEN y dispute_opened en la misma transacción.', ubicacion: 'services/api/src/dispute-system/service/dispute-creation.service.ts', produce: ['dispute_opened'], adr: 'ADR-019', estado: 'hecho' },
    DISP_T: { title: 'disputes', tipo: 'Tabla PostgreSQL', descripcion: 'El caso: estado (OPEN, UNDER_REVIEW, RESOLVED, EXPIRED), fase, resolución y fechas límite de evidencia y SLA.', tecnologia: 'PostgreSQL', ubicacion: 'services/api/src/dispute-system/entities/dispute.entity.ts', estado: 'hecho' },
    ESC_INT_T: { title: 'dispute_escrow_intents', tipo: 'Tabla PostgreSQL', descripcion: 'Intención durable de bloqueo del escrow: OPEN al crear el caso y NONE al terminar. dispute_id ON DELETE SET NULL y payment_id NOT NULL para sobrevivir al caso.', tecnologia: 'PostgreSQL', ubicacion: 'services/api/src/dispute-system/entities/dispute-escrow-intent.entity.ts', estado: 'hecho' },
    ESC_WORKER: { title: 'EscrowIntentWorker', tipo: 'Worker BullMQ', descripcion: 'Drena intenciones OPEN y NONE con lease (DISPUTE_INTENT_LEASE_MS, mayor que el intervalo) y llama a setDisputeStatus por payment_id.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/dispute-system/jobs/escrow-intent.worker.ts', estado: 'hecho' },
    CLIENTE_ESC: { title: 'EscrowClient', tipo: 'Puente a Pagos', descripcion: 'Único puente hacia Pagos: delgado, inyectable y simulable; sin Stripe. Expone setDisputeStatus, releaseForDispute y refundForDispute.', ubicacion: 'services/api/src/dispute-system/escrow/escrow.client.ts', estado: 'hecho' },
    PAGOS_D: { title: 'Pagos · DisputeService y DisputeSettlementService', tipo: 'Servicio de Pagos', descripcion: 'Autoridad del dinero. Garantiza a lo sumo un efecto financiero de disputa por pago (guard dispute_settled_at, PAYMENT_ALREADY_SETTLED), calcula montos, topes y la reversión proporcional si ya se liberó.', tecnologia: 'Stripe Connect', ubicacion: 'services/api/src/payments', adr: 'ADR-005', estado: 'parcial', nota: 'Los efectos reales de reembolso y liberación requieren llaves de Stripe.' },
    HOST_D: { title: 'DisputeHostScreen', tipo: 'Pantalla móvil', descripcion: 'El Host elige el motivo con ReasonPicker, adjunta evidencia y sigue el caso.', ubicacion: 'apps/mobile/src/screens/dispute/DisputeHostScreen.tsx', estado: 'hecho' },
    CLEAN_D: { title: 'DisputeCleanerScreen', tipo: 'Pantalla móvil', descripcion: 'El Cleaner ve el caso y aporta su evidencia dentro de la ventana.', ubicacion: 'apps/mobile/src/screens/dispute/DisputeCleanerScreen.tsx', estado: 'hecho' },
    SUBE_D: { title: 'EvidenceUploader', tipo: 'Componente móvil', descripcion: 'Elige una foto, pide la URL firmada, sube directo a MinIO y finaliza.', tecnologia: 'expo-image-picker', ubicacion: 'apps/mobile/src/screens/dispute/components/EvidenceUploader.tsx', estado: 'parcial', nota: 'La captura real requiere dispositivo físico; solo está cubierta con mocks.' },
    GALERIA_D: { title: 'EvidenceGallery', tipo: 'Componente móvil', descripcion: 'Muestra la evidencia visual con URLs firmadas de corta duración y la estructurada como datos.', ubicacion: 'apps/mobile/src/screens/dispute/EvidenceGallery.tsx', estado: 'hecho' },
    RESUM_D: { title: 'OutcomeSummary', tipo: 'Componente móvil', descripcion: 'Resumen del resultado y, con useResolutionCountdown, la cuenta regresiva del SLA.', ubicacion: 'apps/mobile/src/screens/dispute/components/OutcomeSummary.tsx', estado: 'hecho' },
    CTRL_D: { title: 'DisputeController', tipo: 'Controlador NestJS', descripcion: 'Superficie REST /disputes con JWT. No hay POST /disputes. Reembolso y liberación no son acciones REST: solo las conducen los workers. Un no participante recibe 403.', ubicacion: 'services/api/src/dispute-system/dispute.controller.ts', estado: 'hecho' },
    VISTA_D: { title: 'DisputeViewService', tipo: 'Servicio NestJS', descripcion: 'Vista de reconciliación con estado, fase, resolución, referencias de evidencia y fechas límite. Nunca expone campos internos de las intenciones.', ubicacion: 'services/api/src/dispute-system/service/dispute-view.service.ts', estado: 'hecho' },
    EVID_D: { title: 'DisputeEvidenceService', tipo: 'Servicio NestJS', descripcion: 'Concesión de subida, finalización con ventana e inspección del servidor, evidencia estructurada HOST_REASON y NOTE, y resolución de URL de evidencia.', ubicacion: 'services/api/src/dispute-system/service/dispute-evidence.service.ts', estado: 'hecho' },
    UPSTREAM_D: { title: 'UpstreamEvidenceReader', tipo: 'Lector de solo lectura', descripcion: 'Resuelve referencias estructuradas (CHECKLIST_REF, CHECKLIST_PHOTO_REF, VERIFICATION_REF, ARRIVAL_REF) de los módulos de Seguimiento, Verificación y Checklist.', ubicacion: 'services/api/src/dispute-system/evidence/upstream-evidence.reader.ts', estado: 'hecho' },
    LIFE_D: { title: 'DisputeLifecycleService', tipo: 'Servicio NestJS', descripcion: 'resolve restringido al resolver (DISPUTE_RESOLVER_ROLE): transición de un solo ganador a RESOLVED con su intención financiera y dispute_resolved.', ubicacion: 'services/api/src/dispute-system/service/dispute-lifecycle.service.ts', produce: ['dispute_resolved'], estado: 'hecho' },
    RES_D: { title: 'DisputeResolutionService', tipo: 'Servicio NestJS', descripcion: 'Convierte la resolución en una intención financiera durable. No llama a Stripe y no limpia el escrow aquí.', ubicacion: 'services/api/src/dispute-system/service/dispute-resolution.service.ts', estado: 'hecho' },
    MAPEO_D: { title: 'resolution-mapping', tipo: 'Función pura', descripcion: 'Elige acción y monto solicitado: FAVOR_CLEANER a RELEASE, FAVOR_HOST a FULL_REFUND y PARTIAL a PARTIAL_REFUND (exige entero no negativo). Pagos calcula montos y topes exactos.', ubicacion: 'services/api/src/dispute-system/policy/resolution-mapping.ts', estado: 'hecho' },
    MINIO_D: { title: 'MinIO · evidencia de disputas', tipo: 'Almacenamiento de objetos', descripcion: 'Bucket privado para HOST_PHOTO. Credenciales MINIO_* solo en el servidor; al cliente solo llegan URLs firmadas con TTL acotado.', tecnologia: 'MinIO', ubicacion: 'infra/docker', estado: 'externo' },
    FIN_INT_T: { title: 'dispute_financial_intents', tipo: 'Tabla PostgreSQL', descripcion: 'Intención financiera con estados PENDING, DISPATCHED, ACCEPTED, FAILED_RETRYABLE y ACTION_BLOCKED. El índice único uq_dispute_financial_intent_dispute garantiza exactamente una por disputa.', tecnologia: 'PostgreSQL', ubicacion: 'services/api/src/dispute-system/entities/dispute-financial-intent.entity.ts', estado: 'hecho' },
    FIN_WORKER: { title: 'FinancialIntentWorker', tipo: 'Worker BullMQ', descripcion: 'Drena intenciones PENDING hacia reembolso o liberación de Pagos, limpia el escrow al final y convierte BLOCKED en ACTION_BLOCKED.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/dispute-system/jobs/financial-intent.worker.ts', estado: 'hecho' },
    DEC_ACCION: { title: '¿Qué resolución se aplica?', tipo: 'Decisión', descripcion: 'Despacho puro según DisputeResolution.', ubicacion: 'services/api/src/dispute-system/policy/resolution-mapping.ts', estado: 'hecho' },
    LIBERA_D: { title: 'RELEASE', tipo: 'Acción financiera', descripcion: 'FAVOR_CLEANER: libera los fondos retenidos. Si la fase es POST_RELEASE, Pagos lo acepta como operación nula.', estado: 'hecho' },
    REEMB_TOTAL: { title: 'FULL_REFUND', tipo: 'Acción financiera', descripcion: 'FAVOR_HOST: reembolso total. En POST_RELEASE, Pagos agrega la reversión proporcional de la transferencia.', estado: 'parcial', nota: 'Reembolso real requiere llaves de Stripe.' },
    REEMB_PARC: { title: 'PARTIAL_REFUND', tipo: 'Acción financiera', descripcion: 'PARTIAL: reembolso del monto solicitado en refundCents; Pagos aplica el tope. Si no hay monto válido, la resolución falla.', estado: 'parcial', nota: 'Reembolso real requiere llaves de Stripe.' },
    BLOQ_D: { title: 'ACTION_BLOCKED', tipo: 'Estado terminal', descripcion: 'Pagos devolvió BLOCKED: la intención queda en revisión y el escrow permanece OPEN, nunca se limpia.', estado: 'hecho' },
    LIMPIA_D: { title: 'setDisputeStatus NONE', tipo: 'Acción', descripcion: 'Solo cuando Pagos aplica la acción (APPLIED, CEILING_CLAMPED o NO_OP) se encola la intención NONE que limpia el bloqueo del escrow.', estado: 'hecho' },
    OB_D: { title: 'dispute_outbox', tipo: 'Tabla outbox', descripcion: 'Filas dispute_opened y dispute_resolved escritas en la misma transacción que la transición, con ids y enums solamente.', ubicacion: 'services/api/src/dispute-system/dispute-outbox.ts', produce: ['dispute_opened', 'dispute_resolved'], estado: 'hecho' },
    EVT_OP: { title: 'dispute_opened', tipo: 'Evento de dominio', descripcion: 'Se emite al crear el caso; consumidores aguas abajo notifican a las partes.', ubicacion: 'services/api/src/dispute-system/dispute.types.ts', produce: ['dispute_opened'], estado: 'hecho' },
    EVT_RES: { title: 'dispute_resolved', tipo: 'Evento de dominio', descripcion: 'Se emite al resolver o expirar.', ubicacion: 'services/api/src/dispute-system/dispute.types.ts', produce: ['dispute_resolved'], estado: 'hecho' },
    ABIERTA: { title: 'OPEN', tipo: 'Estado', descripcion: 'Caso creado; la ventana de evidencia (DISPUTE_EVIDENCE_WINDOW_MS) está abierta.', estado: 'hecho' },
    REVISION: { title: 'UNDER_REVIEW', tipo: 'Estado', descripcion: 'Caso en revisión del resolver; sigue siendo no terminal para el SLA.', estado: 'hecho' },
    GANA: { title: '¿Primero el resolver o el SLA?', tipo: 'Decisión', descripcion: 'Resolución manual y vencimiento compiten por una sola transición terminal: exactamente uno de RESOLVED o EXPIRED y una sola intención financiera.', ubicacion: 'services/api/src/dispute-system/repository/dispute.repository.ts', estado: 'hecho' },
    RESUELTA: { title: 'RESOLVED', tipo: 'Estado terminal', descripcion: 'Resuelta por el resolver con FAVOR_CLEANER, FAVOR_HOST o PARTIAL.', estado: 'hecho' },
    VENCIDA: { title: 'EXPIRED', tipo: 'Estado terminal', descripcion: 'Venció DISPUTE_RESOLUTION_SLA_MS; se aplica la resolución de respaldo DISPUTE_FALLBACK_RESOLUTION.', estado: 'hecho' },
    SLA_J: { title: 'DisputeSlaSweepProcessor', tipo: 'Worker BullMQ', descripcion: 'Barrido acotado de casos no terminales vencidos (DISPUTE_SLA_SWEEP_*).', tecnologia: 'BullMQ', ubicacion: 'services/api/src/dispute-system/jobs/dispute-sla-sweep.processor.ts', estado: 'hecho' },
    SLA_SVC: { title: 'DisputeSlaService', tipo: 'Servicio NestJS', descripcion: 'expireDue con la resolución de respaldo obligatoria.', ubicacion: 'services/api/src/dispute-system/service/dispute-sla.service.ts', estado: 'hecho' },
    RETEN_J: { title: 'EvidenceRetentionProcessor', tipo: 'Worker BullMQ', descripcion: 'Borra objetos de evidencia solo de casos terminales pasado el horizonte (DISPUTE_EVIDENCE_RETENTION_DAYS más el margen de auditoría).', tecnologia: 'BullMQ', ubicacion: 'services/api/src/dispute-system/jobs/evidence-retention.processor.ts', estado: 'hecho' },
    GRANT_J: { title: 'StaleGrantCleanupProcessor', tipo: 'Worker BullMQ', descripcion: 'Limpia subidas huérfanas y concesiones ISSUED obsoletas.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/dispute-system/jobs/stale-grant-cleanup.processor.ts', estado: 'hecho' },
    TOMBA_J: { title: 'TombstoneDrainProcessor', tipo: 'Worker BullMQ', descripcion: 'Vacía las lápidas pendientes de claves liberadas y borra el objeto en MinIO.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/dispute-system/jobs/tombstone-drain.processor.ts', estado: 'hecho' },
    TOMBA_D: { title: 'dispute_object_deletions', tipo: 'Tabla PostgreSQL', descripcion: 'Lápidas PENDING y DONE de claves HOST_PHOTO liberadas.', tecnologia: 'PostgreSQL', ubicacion: 'services/api/src/dispute-system/entities/dispute-object-deletion.entity.ts', estado: 'hecho' },
    UNICA_FIN: { title: 'Una sola intención financiera', tipo: 'Invariante', descripcion: 'Resolver y SLA producen exactamente una intención por disputa gracias al índice único uq_dispute_financial_intent_dispute.', ubicacion: 'services/api/src/dispute-system/entities/dispute-financial-intent.entity.ts', estado: 'hecho' },
  },
  sections: [
    {
      title: 'Endpoints de disputes',
      html: `<table>
<thead><tr><th>Método</th><th>Ruta</th><th>Descripción</th></tr></thead>
<tbody>
<tr><td>GET</td><td><code>/disputes/:id</code></td><td>Estado, fase, resolución, referencias de evidencia y fechas límite (participante o resolver).</td></tr>
<tr><td>POST</td><td><code>/disputes/:id/evidence/request-upload</code></td><td>Concesión y URL firmada de subida; solo dentro de la ventana y con el caso no terminal.</td></tr>
<tr><td>POST</td><td><code>/disputes/:id/evidence/finalize</code></td><td>Finaliza una foto con { objectKey }; valida concesión, ventana e inspección del servidor.</td></tr>
<tr><td>POST</td><td><code>/disputes/:id/evidence</code></td><td>Agrega evidencia estructurada HOST_REASON o NOTE dentro de la ventana.</td></tr>
<tr><td>GET</td><td><code>/disputes/:id/evidence/:evidenceId/url</code></td><td>Evidencia visual con URL firmada de lectura; la estructurada como datos con control de acceso.</td></tr>
<tr><td>POST</td><td><code>/disputes/:id/resolve</code></td><td>Solo resolver: { resolution, refundCents? }, de un solo ganador, con intención financiera y outbox.</td></tr>
</tbody></table>`,
    },
    {
      title: 'Reembolso frente a liberación',
      html: `<table>
<thead><tr><th>Resolución</th><th>Acción</th><th>Fase PRE_RELEASE</th><th>Fase POST_RELEASE</th></tr></thead>
<tbody>
<tr><td>FAVOR_CLEANER</td><td>RELEASE</td><td>Libera los fondos retenidos al Cleaner.</td><td>Pagos lo acepta como operación nula (ya liberado).</td></tr>
<tr><td>FAVOR_HOST</td><td>FULL_REFUND</td><td>Reembolso total al Host.</td><td>Reembolso con reversión proporcional de la transferencia.</td></tr>
<tr><td>PARTIAL</td><td>PARTIAL_REFUND</td><td>Reembolso del monto pedido, con tope aplicado por Pagos.</td><td>Igual, con reversión proporcional.</td></tr>
</tbody></table>
<p>Si Pagos responde BLOCKED, la intención queda en <code>ACTION_BLOCKED</code> para revisión y el escrow sigue en OPEN.</p>`,
    },
    {
      title: 'Configuración',
      html: `<p>Bloque <code>DISPUTE_*</code> validado por <code>validateDisputeConfig()</code> (el lease debe superar el intervalo de drenaje; piso de retención): ventana de evidencia, SLA, resolución de respaldo y monto parcial de respaldo, códigos de motivo, política de inicio, bucket, tamaños, tipos y TTL de evidencia, retención, intervalos y lotes, y <code>DISPUTE_RESOLVER_ROLE</code>. No se agregan llaves de Stripe; se reutiliza <code>MINIO_*</code>.</p>`,
    },
  ],
});
