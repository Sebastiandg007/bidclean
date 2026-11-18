/**
 * 32-cierre.js — cierre del servicio: confirmación del Host, liberación automática, disputa y calificación mutua; la decisión genera una intención durable que libera el escrow.
 */
BidCleanArch.registerTab({
  id: 'cierre',
  group: 'Ejecución del servicio',
  order: 320,
  title: 'Cierre del servicio',
  summary:
    'Cierra el ciclo de ejecución. Tras <code>checklist_completed</code> el Host <b>confirma</b> su satisfacción, no hace nada (una <b>liberación automática</b> se dispara al vencer la ventana, 24 h por defecto) o <b>abre una disputa</b>, que pausa la liberación automática. '
    + 'La calificación mutua se captura al final pero nunca condiciona la liberación. '
    + 'Este módulo es dueño de la <b>decisión</b>, no del dinero: en la misma transacción que la decisión persiste una <code>release_intent</code> durable y un worker la drena hacia <code>EscrowReleaseService.release</code> con reintentos idempotentes y arrendamiento (lease) para recuperarse de caídas. No tiene llaves de Stripe ni recalcula comisiones (ADR-018). '
    + 'Estado: backend y app implementados; la liberación real hacia Stripe depende de llaves y cuenta Connect reales.',
  diagrams: [
    {
      title: 'De checklist_completed a payment.released',
      description: 'La decisión, la intención de liberación y el evento de outbox se escriben juntos. El worker de intenciones es la única vía que llama al escrow; el dinero sigue siendo autoridad de Pagos.',
      code: `flowchart TB
  CHK_OB[("checklist_outbox<br/>checklist_completed")]
  CONS_CIE["CompletionCreatedConsumer<br/>checkpoint consumer_name completion"]
  CREA_CIE["CompletionCreationService<br/>fecha límite desde completedAt"]
  COMP_T[("service_completions<br/>estado y fecha límite snapshot")]
  subgraph SG_APP_CIE["App móvil"]
    HOST_PANT["CompletionHostScreen<br/>confirmar o disputar"]
    CLEAN_PANT["CompletionCleanerScreen<br/>estado de liberación"]
    CUENTA_CIE["AutoReleaseCountdown<br/>cuenta regresiva"]
    ACCIONES_CIE["ConfirmDisputeActions<br/>botones del Host"]
    RATING_CIE["RatingSheet<br/>1 a 5 estrellas y comentario"]
  end
  subgraph SG_API_CIE["API · ServiceCompletionModule"]
    CTRL_CIE["CompletionController<br/>/service-completions"]
    VISTA_CIE["CompletionViewService<br/>release_status derivado"]
    DECIDE_CIE["CompletionDecisionService<br/>confirm, openDispute, postRelease"]
    RATING_SVC["RatingService<br/>una calificación por lado"]
    AUTO_SVC["AutoReleaseService<br/>autoReleaseDue de un solo ganador"]
  end
  BARRIDO_CIE["AutoReleaseSweepProcessor<br/>BullMQ repetible y acotado"]
  INTENT_T[("release_intents<br/>PENDING, DISPATCHED, ACCEPTED")]
  OB_CIE[("completion_outbox<br/>misma transacción que la decisión")]
  EVT_CONF["service_confirmed"]
  EVT_DISP["service_disputed"]
  EVT_RATED["service_rated"]
  DISPUTAS_CIE["Disputas<br/>consumidor consumer_name dispute"]
  WORKER_CIE["ReleaseIntentWorker<br/>claim con lease y drenaje"]
  ESC_REL["EscrowReleaseService.release<br/>idempotente"]
  STRIPE_CIE["Stripe Connect<br/>transferencia al Cleaner"]
  EVT_PAY["payment.released<br/>evento de Pagos"]

  CHK_OB --> CONS_CIE
  CONS_CIE --> CREA_CIE
  CREA_CIE --> COMP_T
  CLEAN_PANT -->|GET completion| CTRL_CIE
  HOST_PANT --> ACCIONES_CIE
  HOST_PANT --> CUENTA_CIE
  HOST_PANT --> RATING_CIE
  ACCIONES_CIE -->|POST confirm o dispute| CTRL_CIE
  RATING_CIE -->|POST ratings| CTRL_CIE
  CTRL_CIE --> VISTA_CIE
  CTRL_CIE --> DECIDE_CIE
  CTRL_CIE --> RATING_SVC
  DECIDE_CIE -->|single-winner| COMP_T
  DECIDE_CIE -->|HOST_CONFIRMED en 1 tx| INTENT_T
  DECIDE_CIE --> OB_CIE
  RATING_SVC --> OB_CIE
  BARRIDO_CIE --> AUTO_SVC
  AUTO_SVC -->|AUTO_RELEASED| COMP_T
  AUTO_SVC -->|AUTO_RELEASE en 1 tx| INTENT_T
  OB_CIE --> EVT_CONF
  OB_CIE --> EVT_DISP
  OB_CIE --> EVT_RATED
  EVT_DISP --> DISPUTAS_CIE
  INTENT_T --> WORKER_CIE
  WORKER_CIE --> ESC_REL
  ESC_REL --> STRIPE_CIE
  ESC_REL --> EVT_PAY`,
    },
    {
      title: 'Estados de la decisión y de la intención de liberación',
      description: 'La decisión es de un solo ganador: confirmar, auto-liberar o disputar. La disputa posterior a la liberación solo se permite cuando la intención ya fue aceptada por Pagos.',
      code: `flowchart LR
  ESPERA_CIE["AWAITING_CONFIRMATION<br/>ventana abierta"]
  VENCE_CIE{"¿Venció la ventana<br/>sin decisión?"}
  CONFIRMADO_CIE(["CONFIRMED<br/>Host satisfecho"])
  AUTOLIB_CIE(["AUTO_RELEASED<br/>liberación automática"])
  DISPUTADO_CIE(["DISPUTED<br/>suprime la liberación automática"])
  I_PEND["Intención PENDING"]
  I_DESP["Intención DISPATCHED<br/>lease reclamado"]
  I_OK(["Intención ACCEPTED<br/>release_status ACCEPTED"])
  I_REINT["Intención FAILED_RETRYABLE<br/>vuelve al drenaje"]
  POST_ACEPTADA{"¿release_status<br/>es ACCEPTED?"}
  POST_DISP["post-release-dispute<br/>disputa posterior a la liberación"]
  RECHAZA_409["409 conflicto<br/>sin liberación aceptada"]

  ESPERA_CIE -->|POST confirm| CONFIRMADO_CIE
  ESPERA_CIE -->|POST dispute| DISPUTADO_CIE
  ESPERA_CIE --> VENCE_CIE
  VENCE_CIE -->|sí| AUTOLIB_CIE
  VENCE_CIE -->|no| ESPERA_CIE
  CONFIRMADO_CIE -->|HOST_CONFIRMED| I_PEND
  AUTOLIB_CIE -->|AUTO_RELEASE| I_PEND
  I_PEND -->|claimForDispatch| I_DESP
  I_DESP -->|release exitoso| I_OK
  I_DESP -->|error transitorio| I_REINT
  I_REINT -->|lease vencido| I_DESP
  I_OK --> POST_ACEPTADA
  POST_ACEPTADA -->|sí| POST_DISP
  POST_ACEPTADA -->|no| RECHAZA_409`,
    },
  ],
  nodes: {
    CHK_OB: { title: 'checklist_outbox · checklist_completed', tipo: 'Tabla outbox', descripcion: 'Origen del cierre. El evento lleva completedAt, el tiempo de fin autoritativo del servidor, del que se congela la fecha límite.', ubicacion: 'services/api/src/checklist-photos/entities/checklist-outbox.entity.ts', produce: ['checklist_completed'], estado: 'hecho' },
    CONS_CIE: { title: 'CompletionCreatedConsumer', tipo: 'Consumidor de eventos', descripcion: 'Drena checklist_completed con su propio checkpoint (checklist_outbox_consumers, consumer_name = completion). Intervalo y lote por SERVICE_COMPLETION_CREATION_DRAIN_*.', tecnologia: '@nestjs/schedule', ubicacion: 'services/api/src/service-completion/consumers/completion-created.consumer.ts', consume: ['checklist_completed'], estado: 'hecho' },
    CREA_CIE: { title: 'CompletionCreationService', tipo: 'Servicio NestJS', descripcion: 'createFromChecklistCompleted es idempotente y congela la fecha límite desde completedAt con SERVICE_AUTO_RELEASE_WINDOW_MS (24 h). Si falta completedAt rechaza el evento.', ubicacion: 'services/api/src/service-completion/service/completion-creation.service.ts', estado: 'hecho' },
    COMP_T: { title: 'service_completions', tipo: 'Tabla PostgreSQL', descripcion: 'La decisión durable del cierre, con estado, fecha límite snapshot y post_release_dispute_id. Máquina de estados previa a la liberación.', tecnologia: 'PostgreSQL', ubicacion: 'services/api/src/service-completion/entities/service-completion.entity.ts', adr: 'ADR-018', estado: 'hecho' },
    HOST_PANT: { title: 'CompletionHostScreen', tipo: 'Pantalla móvil', descripcion: 'Pantalla del Host: resumen, cuenta regresiva, confirmar o disputar y calificar.', ubicacion: 'apps/mobile/src/screens/completion/CompletionHostScreen.tsx', estado: 'hecho' },
    CLEAN_PANT: { title: 'CompletionCleanerScreen', tipo: 'Pantalla móvil', descripcion: 'Pantalla del Cleaner: estado de la decisión del Host, ReleaseStatusBadge y calificación.', ubicacion: 'apps/mobile/src/screens/completion/CompletionCleanerScreen.tsx', estado: 'hecho' },
    CUENTA_CIE: { title: 'AutoReleaseCountdown', tipo: 'Componente móvil', descripcion: 'Cuenta regresiva basada en useAutoReleaseCountdown hacia la fecha límite del servidor.', ubicacion: 'apps/mobile/src/screens/completion/components/AutoReleaseCountdown.tsx', estado: 'hecho' },
    ACCIONES_CIE: { title: 'ConfirmDisputeActions', tipo: 'Componente móvil', descripcion: 'Botones del Host para confirmar la satisfacción o abrir una disputa.', ubicacion: 'apps/mobile/src/screens/completion/components/ConfirmDisputeActions.tsx', estado: 'hecho' },
    RATING_CIE: { title: 'RatingSheet', tipo: 'Componente móvil', descripcion: 'Hoja de calificación de 1 a 5 estrellas con comentario opcional; nunca bloquea la liberación.', ubicacion: 'apps/mobile/src/screens/completion/components/RatingSheet.tsx', estado: 'hecho' },
    CTRL_CIE: { title: 'CompletionController', tipo: 'Controlador NestJS', descripcion: 'Superficie REST /service-completions con JWT. La liberación no es una acción REST: solo la conduce el worker de intenciones. Un no participante recibe 403.', ubicacion: 'services/api/src/service-completion/completion.controller.ts', estado: 'hecho' },
    VISTA_CIE: { title: 'CompletionViewService', tipo: 'Servicio NestJS', descripcion: 'Vista de reconciliación con release_status derivado (NOT_TRIGGERED, PENDING, ACCEPTED); nunca expone campos internos de la intención.', ubicacion: 'services/api/src/service-completion/service/completion-view.service.ts', estado: 'hecho' },
    DECIDE_CIE: { title: 'CompletionDecisionService', tipo: 'Servicio NestJS', descripcion: 'Solo el Host: confirm, openDispute y openPostReleaseDispute, todos de un solo ganador. La confirmación escribe decisión, intención HOST_CONFIRMED y outbox en una transacción.', ubicacion: 'services/api/src/service-completion/service/completion-decision.service.ts', produce: ['service_confirmed', 'service_disputed'], estado: 'hecho' },
    RATING_SVC: { title: 'RatingService', tipo: 'Servicio NestJS', descripcion: 'Una calificación por lado (Host o Cleaner), rango SERVICE_RATING_MIN_STARS a MAX_STARS (1 a 5). Escribe service_rated en la misma transacción.', ubicacion: 'services/api/src/service-completion/service/rating.service.ts', produce: ['service_rated'], estado: 'hecho' },
    AUTO_SVC: { title: 'AutoReleaseService', tipo: 'Servicio NestJS', descripcion: 'autoReleaseDue: transición de un solo ganador frente a una confirmación o disputa concurrente, con su intención AUTO_RELEASE.', ubicacion: 'services/api/src/service-completion/service/auto-release.service.ts', estado: 'hecho' },
    BARRIDO_CIE: { title: 'AutoReleaseSweepProcessor', tipo: 'Worker BullMQ', descripcion: 'Barrido repetible, acotado e idempotente de completions vencidas (SERVICE_COMPLETION_SWEEP_INTERVAL_MS y BATCH_SIZE).', tecnologia: 'BullMQ', ubicacion: 'services/api/src/service-completion/jobs/auto-release-sweep.processor.ts', estado: 'hecho' },
    INTENT_T: { title: 'release_intents', tipo: 'Tabla PostgreSQL', descripcion: 'Comando financiero durable. Estados PENDING, DISPATCHED, ACCEPTED y FAILED_RETRYABLE. Razones HOST_CONFIRMED y AUTO_RELEASE.', tecnologia: 'PostgreSQL', ubicacion: 'services/api/src/service-completion/entities/release-intent.entity.ts', estado: 'hecho' },
    OB_CIE: { title: 'completion_outbox', tipo: 'Tabla outbox', descripcion: 'Eventos con ids determinísticos, escritos en la misma transacción que la decisión o la calificación.', ubicacion: 'services/api/src/service-completion/completion-outbox.ts', produce: ['service_confirmed', 'service_disputed', 'service_rated'], estado: 'hecho' },
    EVT_CONF: { title: 'service_confirmed', tipo: 'Evento de dominio', descripcion: 'El Host confirmó. Lo consumen Notificaciones y Reputación.', ubicacion: 'services/api/src/service-completion/completion.types.ts', produce: ['service_confirmed'], estado: 'hecho' },
    EVT_DISP: { title: 'service_disputed', tipo: 'Evento de dominio', descripcion: 'El Host abrió una disputa (previa o posterior a la liberación). Es el disparador de dispute-system.', ubicacion: 'services/api/src/service-completion/completion.types.ts', produce: ['service_disputed'], estado: 'hecho' },
    EVT_RATED: { title: 'service_rated', tipo: 'Evento de dominio', descripcion: 'Una de las dos partes calificó. Alimenta Reputación y no condiciona la liberación.', ubicacion: 'services/api/src/service-completion/completion.types.ts', produce: ['service_rated'], estado: 'hecho' },
    DISPUTAS_CIE: { title: 'Disputas', tipo: 'Consumidor aguas abajo', descripcion: 'dispute-system lee service_disputed con consumer_name = dispute y crea el caso (tab Disputas).', ubicacion: 'services/api/src/dispute-system/consumers/dispute-created.consumer.ts', consume: ['service_disputed'], estado: 'hecho' },
    WORKER_CIE: { title: 'ReleaseIntentWorker', tipo: 'Worker BullMQ', descripcion: 'Drena intenciones, reclama con lease (SERVICE_COMPLETION_RELEASE_INTENT_LEASE_MS, mayor que el intervalo) y llama a EscrowReleaseService.release. Es la única vía hacia Pagos. Mapea AUTO_RELEASE o HOST_CONFIRMED a ReleaseReason.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/service-completion/jobs/release-intent.worker.ts', estado: 'hecho' },
    ESC_REL: { title: 'EscrowReleaseService.release', tipo: 'Servicio de Pagos', descripcion: 'Libera los fondos retenidos de forma idempotente: repetir la llamada tras recuperar un lease es una operación nula. Es la autoridad del dinero.', ubicacion: 'services/api/src/payments/escrow/escrow-release.service.ts', adr: 'ADR-005', estado: 'parcial', nota: 'Requiere llaves y cuenta Connect reales de Stripe.' },
    STRIPE_CIE: { title: 'Stripe Connect', tipo: 'Servicio externo', descripcion: 'Transfiere al Cleaner el monto retenido menos la comisión. Este módulo no tiene llaves ni hace llamadas a Stripe.', tecnologia: 'Stripe Connect', ubicacion: 'services/api/src/payments', adr: 'ADR-005', estado: 'externo' },
    EVT_PAY: { title: 'payment.released', tipo: 'Evento de dominio', descripcion: 'Emitido por Pagos al liberar. Notificaciones y reportes lo consumen.', ubicacion: 'services/api/src/payments/payment-outbox.ts', produce: ['payment.released'], estado: 'hecho' },
    ESPERA_CIE: { title: 'AWAITING_CONFIRMATION', tipo: 'Estado', descripcion: 'Estado inicial: el Host puede confirmar, disputar o dejar correr la ventana.', estado: 'hecho' },
    VENCE_CIE: { title: '¿Venció la ventana?', tipo: 'Decisión', descripcion: 'El barrido compara la fecha límite congelada con el reloj del servidor.', ubicacion: 'services/api/src/service-completion/jobs/auto-release-sweep.processor.ts', estado: 'hecho' },
    CONFIRMADO_CIE: { title: 'CONFIRMED', tipo: 'Estado terminal', descripcion: 'El Host confirmó; crea la intención HOST_CONFIRMED y emite service_confirmed.', produce: ['service_confirmed'], estado: 'hecho' },
    AUTOLIB_CIE: { title: 'AUTO_RELEASED', tipo: 'Estado terminal', descripcion: 'Venció la ventana sin decisión; crea la intención AUTO_RELEASE.', estado: 'hecho' },
    DISPUTADO_CIE: { title: 'DISPUTED', tipo: 'Estado terminal', descripcion: 'Disputa previa a la liberación; suprime la liberación automática y emite service_disputed.', produce: ['service_disputed'], estado: 'hecho' },
    I_PEND: { title: 'Intención PENDING', tipo: 'Estado', descripcion: 'Recién creada, lista para el drenaje.', estado: 'hecho' },
    I_DESP: { title: 'Intención DISPATCHED', tipo: 'Estado', descripcion: 'Reclamada por un worker con lease; si el worker cae, otro puede reclamarla al vencer el lease.', estado: 'hecho' },
    I_OK: { title: 'Intención ACCEPTED', tipo: 'Estado terminal', descripcion: 'Pagos aceptó la liberación; la vista deriva release_status = ACCEPTED.', estado: 'hecho' },
    I_REINT: { title: 'Intención FAILED_RETRYABLE', tipo: 'Estado', descripcion: 'Falla transitoria; vuelve al drenaje y se reintenta de forma idempotente.', estado: 'hecho' },
    POST_ACEPTADA: { title: '¿release_status es ACCEPTED?', tipo: 'Decisión', descripcion: 'Compuerta de la disputa posterior a la liberación: solo se permite con la liberación ya aceptada.', ubicacion: 'services/api/src/service-completion/repository/completion.repository.ts', estado: 'hecho' },
    POST_DISP: { title: 'post-release-dispute', tipo: 'Acción', descripcion: 'Fija post_release_dispute_id y emite service_disputed. En Disputas la fase pasa a POST_RELEASE.', produce: ['service_disputed'], estado: 'hecho' },
    RECHAZA_409: { title: '409 conflicto', tipo: 'Respuesta de error', descripcion: 'La disputa posterior se rechaza si la liberación aún no fue aceptada.', estado: 'hecho' },
  },
  sections: [
    {
      title: 'Endpoints de service-completions',
      html: `<table>
<thead><tr><th>Método</th><th>Ruta</th><th>Descripción</th></tr></thead>
<tbody>
<tr><td>GET</td><td><code>/service-completions/:id</code></td><td>Estado, fecha límite congelada, estado de calificación y release_status derivado (Host o Cleaner).</td></tr>
<tr><td>POST</td><td><code>/service-completions/:id/confirm</code></td><td>Solo Host: pasa a CONFIRMED y crea la intención HOST_CONFIRMED con service_confirmed.</td></tr>
<tr><td>POST</td><td><code>/service-completions/:id/dispute</code></td><td>Solo Host: pasa a DISPUTED con service_disputed y suprime la liberación automática.</td></tr>
<tr><td>POST</td><td><code>/service-completions/:id/post-release-dispute</code></td><td>Solo Host: disputa posterior; solo si release_status es ACCEPTED, de lo contrario 409.</td></tr>
<tr><td>POST</td><td><code>/service-completions/:id/ratings</code></td><td>Una calificación por lado (1 a 5 y comentario opcional) con service_rated.</td></tr>
<tr><td>GET</td><td><code>/service-completions/:id/ratings</code></td><td>Lectura de calificaciones para participantes.</td></tr>
</tbody></table>`,
    },
    {
      title: 'Configuración',
      html: `<p>Validada al arrancar por <code>validateServiceCompletionConfig()</code>: <code>SERVICE_AUTO_RELEASE_WINDOW_MS</code> (86400000), <code>SERVICE_COMPLETION_SWEEP_INTERVAL_MS</code> y <code>BATCH_SIZE</code>, <code>SERVICE_COMPLETION_RELEASE_INTENT_INTERVAL_MS</code>, <code>BATCH_SIZE</code> y <code>LEASE_MS</code> (debe ser mayor que el intervalo), <code>SERVICE_COMPLETION_CREATION_DRAIN_*</code> y <code>SERVICE_RATING_MIN_STARS</code> y <code>MAX_STARS</code>. No se agregan llaves de Stripe.</p>`,
    },
  ],
});
