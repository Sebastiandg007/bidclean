/**
 * 27-voip.js — llamadas de voz y video dentro de la conversación (LiveKit para medios, Centrifugo para señalización).
 */
BidCleanArch.registerTab({
  id: 'voip',
  group: 'Comunicación',
  order: 270,
  title: 'Llamadas VoIP (LiveKit)',
  summary:
    'Una llamada es un <b>evento de la conversación</b>, no un dominio nuevo: una fila <code>voip_calls</code> ligada a un <code>chat_conversations</code>. '
    + 'El audio y el video viajan cliente ↔ servidor LiveKit (nunca por la API ni por PostgreSQL); el control (invitar, aceptar, rechazar, colgar) se señaliza por el canal Centrifugo de la conversación. '
    + 'La API emite un token de LiveKit de corta vida según una matriz estado + rol. '
    + '<b>Estado:</b> todo el backend y la app móvil están implementados, pero el servidor LiveKit no está desplegado (no existe en infra/docker-compose.yml), así que las llamadas reales no funcionan todavía.',
  diagrams: [
    {
      title: 'Arquitectura de una llamada',
      description: 'Medios por LiveKit, señalización por Centrifugo, estado durable en PostgreSQL y liveness por webhook firmado más dos barridos.',
      code: `flowchart TB
  subgraph SG_APP["App móvil · screens/chat/voip"]
    AFORDANZA["CallAffordance<br/>botón de voz o video, solo OPEN"]
    SENAL_HOOK["useCallSignaling<br/>parsea frames call_*"]
    ALMACEN_CALL["voip.store<br/>una llamada activa, sin regresar estado"]
    SALA_HOOK["useLiveKitRoom<br/>conectar, silenciar, cámara"]
    EN_LLAMADA["InCallScreen"]
    ENTRANTE["IncomingCallSheet<br/>aceptar o rechazar"]
  end
  subgraph SG_API["API NestJS · chat/voip"]
    CTRL_VOIP["VoipController<br/>/chat/conversations/:id/calls"]
    SVC_VOIP["VoipService<br/>máquina de estados y autorización"]
    REPO_VOIP["VoipRepository<br/>escritura condicional single-winner"]
    TOKEN_SVC["LiveKitTokenService<br/>token por sala e identidad"]
    SALA_SVC["LiveKitRoomService<br/>nombre opaco y borrado seguro"]
    HOOK_CTRL["LiveKitWebhookController<br/>POST /webhooks/livekit"]
    BARRIDO["VoipSweepProcessor<br/>RINGING y ONGOING vencidas"]
    ESCUCHA_OFERTA["OfferTerminalCallListener<br/>fuerza el fin al cerrar la oferta"]
  end
  DB_CALL[("voip_calls<br/>estado, sala, duración")]
  OUTBOX_VOIP[("voip_outbox<br/>call-invited")]
  CENTRI_VOIP["Centrifugo<br/>chat:conversation:id"]
  LIVEKIT["Servidor LiveKit<br/>SFU WebRTC rtc.bidclean.tech"]
  PUSH["NotificationsModule<br/>push de llamada entrante"]
  COLA_BARRIDO["Cola voip-calls-sweep<br/>BullMQ repetible"]

  AFORDANZA -->|POST initiate| CTRL_VOIP
  CTRL_VOIP --> SVC_VOIP
  SVC_VOIP --> REPO_VOIP
  REPO_VOIP --> DB_CALL
  SVC_VOIP -->|misma transacción, fila RINGING nueva| OUTBOX_VOIP
  OUTBOX_VOIP -.-> PUSH
  SVC_VOIP --> SALA_SVC
  SVC_VOIP --> TOKEN_SVC
  TOKEN_SVC -->|token de corta vida| ALMACEN_CALL
  SVC_VOIP -->|call_invite, call_accept, call_end| CENTRI_VOIP
  CENTRI_VOIP --> SENAL_HOOK
  SENAL_HOOK --> ALMACEN_CALL
  ALMACEN_CALL --> ENTRANTE
  ALMACEN_CALL --> EN_LLAMADA
  EN_LLAMADA --> SALA_HOOK
  SALA_HOOK -->|audio y video RTP| LIVEKIT
  LIVEKIT -->|webhooks firmados| HOOK_CTRL
  HOOK_CTRL -->|touchMediaActivity o cierre| REPO_VOIP
  COLA_BARRIDO --> BARRIDO
  BARRIDO --> REPO_VOIP
  ESCUCHA_OFERTA --> SVC_VOIP`,
    },
    {
      title: 'Máquina de estados de la llamada',
      description: 'Cada transición terminal es de un solo ganador: UPDATE condicionado al estado no terminal. Una llamada terminal no vuelve a emitir token.',
      code: `flowchart LR
  INICIA(["Iniciar llamada"])
  RINGING["RINGING<br/>sala creada, token del iniciador"]
  ONGOING["ONGOING<br/>ambos en la sala"]
  ENDED(["ENDED<br/>HANGUP o TIMEOUT"])
  MISSED(["MISSED<br/>TIMEOUT_NO_ANSWER"])
  DECLINED(["DECLINED"])
  CANCELED(["CANCELED"])
  FAILED(["FAILED<br/>ERROR"])
  OCUPADO{"¿Ya hay llamada activa?"}
  BUSY(["409 busy<br/>call_busy"])

  INICIA --> OCUPADO
  OCUPADO -->|sí, índice único parcial| BUSY
  OCUPADO -->|no| RINGING
  RINGING -->|answer del receptor| ONGOING
  RINGING -->|decline del receptor| DECLINED
  RINGING -->|cancel del iniciador| CANCELED
  RINGING -->|barrido, 45 s sin respuesta| MISSED
  ONGOING -->|end de cualquiera| ENDED
  ONGOING -->|barrido, medios obsoletos| ENDED
  ONGOING -->|room_finished con error| FAILED
  ONGOING -->|offer terminal, conversación cerrada| ENDED`,
    },
  ],
  nodes: {
    AFORDANZA: { title: 'CallAffordance', tipo: 'Componente móvil', descripcion: 'Botón de llamada de voz (y de video cuando está habilitado) en el encabezado del chat. Solo visible con conversación OPEN.', ubicacion: 'apps/mobile/src/screens/chat/voip/components/CallAffordance.tsx', estado: 'hecho' },
    SENAL_HOOK: { title: 'useCallSignaling', tipo: 'Hook de tiempo real', descripcion: 'Enruta los frames call_* del canal existente chat:conversation:{id} hacia el store mediante el parser puro parseCallSignal.', ubicacion: 'apps/mobile/src/screens/chat/voip/useCallSignaling.ts', consume: ['call_invite', 'call_accept', 'call_end', 'call_busy'], estado: 'hecho' },
    ALMACEN_CALL: { title: 'voip.store', tipo: 'Store Zustand', descripcion: 'Mantiene una sola llamada activa, aplica señales de forma idempotente sin regresar el estado, reconcilia por GET y renueva el token de medios (misma sala, nunca una llamada nueva).', tecnologia: 'Zustand', ubicacion: 'apps/mobile/src/screens/chat/voip/voip.store.ts', estado: 'hecho' },
    SALA_HOOK: { title: 'useLiveKitRoom', tipo: 'Hook móvil', descripcion: 'Sesión de medios con LiveKit: conectar, silenciar, altavoz y cámara. Degrada a solo audio y avisa si se niega el micrófono o la cámara, sin bloquear el chat de texto.', tecnologia: '@livekit/react-native', ubicacion: 'apps/mobile/src/screens/chat/voip/useLiveKitRoom.ts', estado: 'parcial', nota: 'Requiere prebuild nativo y un servidor LiveKit real; las pruebas lo simulan.' },
    EN_LLAMADA: { title: 'InCallScreen', tipo: 'Pantalla móvil', descripcion: 'Superficie de llamada saliente, activa y finalizada, con duración y controles.', ubicacion: 'apps/mobile/src/screens/chat/voip/InCallScreen.tsx', estado: 'hecho' },
    ENTRANTE: { title: 'IncomingCallSheet', tipo: 'Componente móvil', descripcion: 'Hoja de aceptar o rechazar en primer plano. La entrega con la app en segundo plano o cerrada depende del push (voip.router.ts expone openIncomingCall).', ubicacion: 'apps/mobile/src/screens/chat/voip/components/IncomingCallSheet.tsx', estado: 'parcial', nota: 'Sin CallKit ni ConnectionService; el push depende de OneSignal.' },
    CTRL_VOIP: { title: 'VoipController', tipo: 'Controlador NestJS', descripcion: 'Superficie REST con JWT bajo /chat/conversations/:id/calls. Resuelve el sujeto de Keycloak a un usuario BidClean.', ubicacion: 'services/api/src/chat/voip/voip.controller.ts', estado: 'hecho' },
    SVC_VOIP: { title: 'VoipService', tipo: 'Servicio NestJS', descripcion: 'initiate (transacción serializada: participante, OPEN, deduplicación, insert RINGING con sala generada; luego token y call_invite), answer, decline, cancel, end, mintMediaToken y forceEndForConversation.', ubicacion: 'services/api/src/chat/voip/voip.service.ts', produce: ['call_invite', 'call_accept', 'call_end', 'call_busy', 'call-invited'], adr: 'ADR-014', estado: 'hecho' },
    REPO_VOIP: { title: 'VoipRepository', tipo: 'Repositorio', descripcion: 'SQL parametrizado. Transición terminal de un solo ganador (UPDATE ... WHERE status = esperado RETURNING), idempotencia por (conversación, iniciador, clientCallId), consultas acotadas para los barridos y duración calculada una sola vez en SQL.', tecnologia: 'PostgreSQL', ubicacion: 'services/api/src/chat/voip/voip.repository.ts', estado: 'hecho' },
    TOKEN_SVC: { title: 'LiveKitTokenService', tipo: 'Servicio NestJS', descripcion: 'Firma el token de acceso limitado a una sala y una identidad. Audio siempre; cámara solo si media_kind = VIDEO y el video está habilitado. Nunca concede permisos de administración. El secreto no sale del servidor.', tecnologia: 'livekit-server-sdk', ubicacion: 'services/api/src/chat/voip/livekit-token.service.ts', estado: 'hecho' },
    SALA_SVC: { title: 'LiveKitRoomService', tipo: 'Servicio NestJS', descripcion: 'Genera el nombre opaco call-<uuid> (nunca reutilizado) y borra la sala de forma idempotente y best-effort.', tecnologia: 'livekit-server-sdk (RoomServiceClient)', ubicacion: 'services/api/src/chat/voip/livekit-room.service.ts', estado: 'hecho' },
    HOOK_CTRL: { title: 'LiveKitWebhookController', tipo: 'Webhook público', descripcion: 'POST /webhooks/livekit, no usa JWT. Autentica la firma sobre el cuerpo crudo y es idempotente. participant_joined, participant_left y room_started actualizan la actividad; room_finished es una señal y no un veredicto: cierre vacío benigno es ENDED/HANGUP, error explícito es FAILED/ERROR y lo ambiguo lo resuelve el barrido como ENDED/TIMEOUT.', ubicacion: 'services/api/src/chat/voip/livekit-webhook.controller.ts', consume: ['participant_joined', 'participant_left', 'room_started', 'room_finished'], estado: 'hecho' },
    BARRIDO: { title: 'VoipSweepProcessor', tipo: 'Worker BullMQ', descripcion: 'Repetible. A: RINGING vencida pasa a MISSED/TIMEOUT_NO_ANSWER. B: ONGOING con actividad obsoleta o más larga que el máximo pasa a ENDED/TIMEOUT. Publica call_end best-effort; un fallo por ítem no detiene el lote.', tecnologia: 'BullMQ (voip-calls-sweep)', ubicacion: 'services/api/src/chat/voip/voip-sweep.processor.ts', estado: 'hecho' },
    COLA_BARRIDO: { title: 'Cola voip-calls-sweep', tipo: 'Cola BullMQ', descripcion: 'Cola repetible registrada en chat.module.ts; intervalo y lote vienen de VOIP_SWEEP_INTERVAL_MS y VOIP_SWEEP_BATCH_SIZE.', tecnologia: 'BullMQ + Redis', ubicacion: 'services/api/src/chat/voip/voip.constants.ts', estado: 'hecho' },
    ESCUCHA_OFERTA: { title: 'OfferTerminalCallListener', tipo: 'Listener de eventos', descripcion: 'Al pasar la oferta a CANCELLED, EXPIRED o COMPLETED, termina de forma idempotente cualquier llamada activa de sus conversaciones (CONVERSATION_CLOSED). El barrido es el respaldo.', ubicacion: 'services/api/src/chat/voip/offer-terminal-call.listener.ts', consume: ['offer CANCELLED', 'offer EXPIRED', 'offer COMPLETED'], estado: 'hecho' },
    DB_CALL: { title: 'voip_calls', tipo: 'Tabla PostgreSQL', descripcion: 'Una fila por llamada, ligada a una conversación. Índice único parcial sobre estados no terminales: a lo sumo una llamada activa por conversación. Sin deleted_at: la llamada terminal es un hecho de auditoría inmutable.', tecnologia: 'PostgreSQL (migración 1700000040000-CreateVoipCallsTable)', ubicacion: 'services/api/src/chat/voip/entities/voip-call.entity.ts', estado: 'hecho' },
    OUTBOX_VOIP: { title: 'voip_outbox', tipo: 'Tabla outbox', descripcion: 'Fila call-invited escrita en la misma transacción que la llamada RINGING nueva, para despertar al receptor mediante el relay de notificaciones.', ubicacion: 'services/api/src/chat/voip/voip-outbox.ts', produce: ['call-invited'], estado: 'hecho' },
    CENTRI_VOIP: { title: 'Centrifugo', tipo: 'Servicio de tiempo real', descripcion: 'Señalización best-effort por el mismo canal de la conversación. No hay canal ni superficie de tokens nuevos; el cliente reconcilia con GET.', tecnologia: 'Centrifugo', ubicacion: 'services/api/src/offers/delivery/centrifugo.client.ts', estado: 'hecho' },
    LIVEKIT: { title: 'Servidor LiveKit (SFU)', tipo: 'Servicio auto-hospedado', descripcion: 'Transporte de medios WebRTC. LIVEKIT_URL apunta a wss://rtc.bidclean.tech. El contenedor no está definido en infra/docker-compose.yml.', tecnologia: 'LiveKit (self-hosted)', ubicacion: '.env.example', adr: 'ADR-014', estado: 'falta', nota: 'No desplegado: sin servidor no hay medios ni webhooks reales.' },
    PUSH: { title: 'NotificationsModule', tipo: 'Módulo NestJS', descripcion: 'El mapper voip-outbox.mapper.ts convierte call-invited en un push de llamada entrante; en la app, useNotificationRouting abre la hoja de llamada.', ubicacion: 'services/api/src/notifications/mappers/voip-outbox.mapper.ts', consume: ['call-invited'], estado: 'parcial', nota: 'Faltan credenciales de OneSignal.' },
    INICIA: { title: 'Iniciar llamada', tipo: 'Inicio', descripcion: 'POST initiate con clientCallId y mediaKind (AUDIO o VIDEO). Idempotente por (conversación, iniciador, clientCallId).', ubicacion: 'services/api/src/chat/voip/dto/initiate-call.dto.ts', estado: 'hecho' },
    OCUPADO: { title: '¿Ya hay llamada activa?', tipo: 'Decisión', descripcion: 'Lo decide el índice único parcial de la base de datos, no la aplicación: la violación se traduce en 409 busy.', estado: 'hecho' },
    BUSY: { title: '409 busy', tipo: 'Fin', descripcion: 'Se rechaza la segunda llamada y se publica un call_busy mínimo.', produce: ['call_busy'], estado: 'hecho' },
    RINGING: { title: 'RINGING', tipo: 'Estado', descripcion: 'Fila durable creada antes de cualquier token o señal. Solo el iniciador recibe token en este estado; el receptor solo mediante answer.', estado: 'hecho' },
    ONGOING: { title: 'ONGOING', tipo: 'Estado', descripcion: 'Ambos participantes pueden pedir token (rejoin). La actividad de medios la actualiza el webhook firmado, no un latido del cliente.', estado: 'hecho' },
    ENDED: { title: 'ENDED', tipo: 'Estado terminal', descripcion: 'Fin normal (HANGUP), por barrido (TIMEOUT) o por conversación cerrada. La duración se deriva una sola vez.', estado: 'hecho' },
    MISSED: { title: 'MISSED', tipo: 'Estado terminal', descripcion: 'Timeout de timbre sin respuesta (VOIP_RING_TIMEOUT_MS, por defecto 45000). Alimenta el indicador de llamada perdida.', estado: 'hecho' },
    DECLINED: { title: 'DECLINED', tipo: 'Estado terminal', descripcion: 'El receptor rechazó la llamada.', estado: 'hecho' },
    CANCELED: { title: 'CANCELED', tipo: 'Estado terminal', descripcion: 'El iniciador canceló antes de la respuesta.', estado: 'hecho' },
    FAILED: { title: 'FAILED', tipo: 'Estado terminal', descripcion: 'Solo cuando LiveKit cierra la sala con un error explícito. Un timeout ordinario nunca es FAILED.', estado: 'hecho' },
  },
  sections: [
    {
      title: 'Endpoints de llamadas',
      html: `<table>
<thead><tr><th>Método</th><th>Ruta</th><th>Descripción</th></tr></thead>
<tbody>
<tr><td>POST</td><td><code>/chat/conversations/:id/calls</code></td><td>Inicia una llamada (idempotente por clientCallId). Devuelve call, roomName y token de medios.</td></tr>
<tr><td>POST</td><td><code>/chat/conversations/:id/calls/:callId/answer</code></td><td>El receptor contesta: RINGING → ONGOING y recibe su token.</td></tr>
<tr><td>POST</td><td><code>/chat/conversations/:id/calls/:callId/decline</code></td><td>El receptor rechaza: RINGING → DECLINED.</td></tr>
<tr><td>POST</td><td><code>/chat/conversations/:id/calls/:callId/cancel</code></td><td>El iniciador cancela antes de la respuesta: RINGING → CANCELED.</td></tr>
<tr><td>POST</td><td><code>/chat/conversations/:id/calls/:callId/end</code></td><td>Cuelga: ONGOING → ENDED/HANGUP (un solo ganador).</td></tr>
<tr><td>POST</td><td><code>/chat/conversations/:id/calls/:callId/token</code></td><td>Emite un token según la matriz estado + rol (reingreso).</td></tr>
<tr><td>GET</td><td><code>/chat/conversations/:id/calls/:callId</code></td><td>Estado autoritativo para reconciliar.</td></tr>
<tr><td>GET</td><td><code>/chat/conversations/:id/calls</code></td><td>Historial de llamadas (UX de llamada perdida), con cursor before.</td></tr>
<tr><td>POST</td><td><code>/webhooks/livekit</code></td><td>Webhook firmado e idempotente de LiveKit (público, sin JWT).</td></tr>
</tbody></table>`,
    },
    {
      title: 'Variables de configuración',
      html: `<p>Validadas al arrancar por <code>validateVoipConfig()</code> (se omite con NODE_ENV=test): <code>LIVEKIT_URL</code>, <code>LIVEKIT_API_KEY</code>, <code>LIVEKIT_API_SECRET</code>, <code>VOIP_MEDIA_TOKEN_TTL_SECONDS</code>, <code>VOIP_RING_TIMEOUT_MS</code>, <code>VOIP_STALE_CALL_TIMEOUT_MS</code>, <code>VOIP_MAX_CALL_DURATION_MS</code>, <code>VOIP_VIDEO_ENABLED</code>, <code>VOIP_SWEEP_INTERVAL_MS</code>, <code>VOIP_SWEEP_BATCH_SIZE</code>. El cliente lee <code>EXPO_PUBLIC_LIVEKIT_URL</code>.</p>`,
    },
  ],
});
