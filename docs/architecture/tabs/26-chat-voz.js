/**
 * 26-chat-voz.js — chat en tiempo real Host↔Cleaner (texto) y notas de voz con transcripción asíncrona.
 */
BidCleanArch.registerTab({
  id: 'chat-voz',
  group: 'Comunicación',
  order: 260,
  title: 'Chat y notas de voz',
  summary:
    'Mensajería uno a uno entre Host y Cleaner una vez que la oferta está emparejada. '
    + '<b>PostgreSQL es la fuente de verdad</b>: el mensaje se guarda primero y se publica en Centrifugo después (solo transporte). '
    + 'Las notas de voz son mensajes <code>type = VOICE</code> cuyo audio vive en MinIO; la transcripción (Whisper.cpp) es asíncrona y nunca bloquea el envío. '
    + 'Estado: el chat de texto y el envío de voz están implementados; la transcripción real y la traducción automática aún no están conectadas.',
  diagrams: [
    {
      title: 'Chat de texto: envío, persistencia y tiempo real',
      description: 'El mensaje se guarda en PostgreSQL (con su fila en chat_outbox) antes de publicarse en Centrifugo. La app reconcilia lo perdido con el cursor after.',
      code: `flowchart TB
  subgraph SG_MOVIL["App móvil"]
    ENTRADA["ChatEntryScreen<br/>resuelve threadId a conversación"]
    PANTALLA["ChatScreen<br/>lista + composer"]
    ALMACEN["chat.store<br/>envío optimista por clientMessageId"]
    CANAL["useChatChannel<br/>WebSocket + reconexión + reconciliación"]
  end
  subgraph SG_API["API NestJS · ChatModule"]
    CTRL["ChatController<br/>REST /chat"]
    SERVICIO["ChatService<br/>valida, persiste y publica"]
    PARTICIPA["ChatParticipationService<br/>regla de participante"]
    REPO["ChatRepository<br/>SQL parametrizado, envío serializado"]
    ESCUCHA["OfferTerminalChatListener<br/>cierra al terminar la oferta"]
  end
  NEGOCIA["NegotiationRepository<br/>isThreadMatched"]
  AUTH_TOKEN["Auth: token Centrifugo<br/>por canal"]
  DB_CHAT[("chat_conversations<br/>chat_messages")]
  OUTBOX_CHAT[("chat_outbox<br/>message-created")]
  CENTRI["Centrifugo<br/>canal chat:conversation:id"]
  RELE_NOTIF["NotificationsModule<br/>outbox-relay → push"]
  TRADUCE["LibreTranslate<br/>traducción de mensajes"]

  ENTRADA -->|open-or-get| CTRL
  ENTRADA --> PANTALLA
  PANTALLA --> ALMACEN
  ALMACEN -->|POST messages con Idempotency-Key| CTRL
  CTRL --> SERVICIO
  SERVICIO -->|solo si hay match| NEGOCIA
  SERVICIO --> PARTICIPA
  SERVICIO --> REPO
  REPO -->|misma transacción| DB_CHAT
  REPO -->|misma transacción| OUTBOX_CHAT
  SERVICIO -->|publica después, best-effort| CENTRI
  CENTRI -->|mensajes en vivo| CANAL
  CANAL --> ALMACEN
  CANAL -->|GET messages after| CTRL
  CANAL -->|pide token de suscripción| AUTH_TOKEN
  AUTH_TOKEN --> PARTICIPA
  ESCUCHA -->|CANCELLED, EXPIRED, COMPLETED| SERVICIO
  OUTBOX_CHAT -.-> RELE_NOTIF
  SERVICIO -.->|no implementado| TRADUCE`,
    },
    {
      title: 'Notas de voz: subida directa a MinIO y transcripción asíncrona',
      description: 'El audio nunca pasa por la API ni por PostgreSQL. La transcripción es derivada y opcional: si falla, la nota se envía y se reproduce igual.',
      code: `flowchart TB
  GRABA["useVoiceRecorder<br/>expo-av, auto-stop por duración"]
  VOZ_API["voice.api<br/>upload-url, PUT, send"]
  URL_SUBIDA["POST voice-notes/upload-url<br/>participante y OPEN"]
  GRANT[("voice_note_upload_grants<br/>clave de un solo uso")]
  MINIO[("MinIO<br/>bucket chat-voice-notes")]
  ENVIA_VOZ["ChatService.sendVoiceMessage<br/>transacción serializada"]
  SONDA["AudioDurationProbe<br/>duración real del audio"]
  DB_VOZ[("chat_voice_notes<br/>metadatos 1 a 1")]
  COLA_TRANS["Cola BullMQ<br/>voice-notes-transcription"]
  PROC_TRANS["VoiceTranscriptionProcessor<br/>intento monotónico, READY o FAILED"]
  WHISPER["WhisperClient<br/>reintentos con backoff"]
  IA_TRANSCRIBE["IA FastAPI<br/>POST /transcribe"]
  MOTOR["NotConfiguredEngine<br/>sin binario Whisper.cpp"]
  CANAL_VOZ["Centrifugo<br/>voice_transcript_updated"]
  REPRODUCE["VoiceNotePlayer<br/>URL firmada bajo demanda"]
  URL_REPRO["GET playback-url<br/>clave resuelta desde la BD"]
  TOMBA[("voice_note_object_deletions<br/>tombstones")]
  LIMPIEZA["VoiceNoteCleanupProcessor<br/>4 barridos idempotentes"]

  GRABA --> VOZ_API
  VOZ_API -->|1 pide URL| URL_SUBIDA
  URL_SUBIDA --> GRANT
  URL_SUBIDA -->|URL PUT firmada| VOZ_API
  VOZ_API -->|2 sube el audio| MINIO
  VOZ_API -->|3 envía mensaje VOICE| ENVIA_VOZ
  ENVIA_VOZ -->|verifica la grant| GRANT
  ENVIA_VOZ -->|inspecciona el objeto| MINIO
  ENVIA_VOZ --> SONDA
  ENVIA_VOZ -->|mensaje + metadatos + consume grant| DB_VOZ
  ENVIA_VOZ -->|encola| COLA_TRANS
  COLA_TRANS --> PROC_TRANS
  PROC_TRANS -->|lee bytes| MINIO
  PROC_TRANS --> WHISPER
  WHISPER -->|multipart| IA_TRANSCRIBE
  IA_TRANSCRIBE --> MOTOR
  PROC_TRANS -->|adjunta transcripción| DB_VOZ
  PROC_TRANS -->|best-effort| CANAL_VOZ
  CANAL_VOZ --> REPRODUCE
  REPRODUCE --> URL_REPRO
  URL_REPRO -->|URL GET firmada| MINIO
  DB_VOZ -->|trigger BEFORE DELETE| TOMBA
  LIMPIEZA --> TOMBA
  LIMPIEZA -->|borra objetos huérfanos| MINIO
  LIMPIEZA -->|re-encola PENDING atascadas| COLA_TRANS`,
    },
  ],
  nodes: {
    ENTRADA: { title: 'ChatEntryScreen', tipo: 'Pantalla móvil', descripcion: 'Contenedor de navegación: convierte un threadId emparejado en una conversación mediante open-or-get idempotente y monta ChatScreen.', tecnologia: 'React Native + Zustand', ubicacion: 'apps/mobile/src/screens/chat/ChatEntryScreen.tsx', estado: 'hecho' },
    PANTALLA: { title: 'ChatScreen', tipo: 'Pantalla móvil', descripcion: 'Muestra el historial, los mensajes en vivo, el estado vacío o cerrado, y el composer. Propios y de la contraparte se distinguen por el id del usuario autenticado.', tecnologia: 'React Native', ubicacion: 'apps/mobile/src/screens/chat/ChatScreen.tsx', estado: 'hecho' },
    ALMACEN: { title: 'chat.store', tipo: 'Store Zustand', descripcion: 'Envío optimista identificado por clientMessageId, timeout a failed, deduplicación por id y orden por sequenceNumber.', tecnologia: 'Zustand', ubicacion: 'apps/mobile/src/screens/chat/chat.store.ts', estado: 'hecho' },
    CANAL: { title: 'useChatChannel', tipo: 'Hook de tiempo real', descripcion: 'Pide token de conexión y de suscripción, se conecta a chat:conversation:{id}, reconecta con backoff acotado y reconcilia con el cursor after en cada (re)conexión.', tecnologia: 'WebSocket + Centrifugo', ubicacion: 'apps/mobile/src/screens/chat/useChatChannel.ts', estado: 'hecho' },
    CTRL: { title: 'ChatController', tipo: 'Controlador NestJS', descripcion: 'Superficie REST /chat protegida por JWT. Resuelve el sujeto de Keycloak a un usuario BidClean; nunca confía en un id enviado por el cliente.', tecnologia: 'NestJS', ubicacion: 'services/api/src/chat/chat.controller.ts', estado: 'hecho' },
    SERVICIO: { title: 'ChatService', tipo: 'Servicio NestJS', descripcion: 'Abre la conversación solo si el hilo está emparejado, valida el cuerpo, delega al envío transaccional y publica a Centrifugo en modo best-effort. Un fallo de publicación no pierde el mensaje.', tecnologia: 'NestJS', ubicacion: 'services/api/src/chat/chat.service.ts', produce: ['message-created'], adr: 'ADR-009', estado: 'hecho' },
    PARTICIPA: { title: 'ChatParticipationService', tipo: 'Servicio NestJS', descripcion: 'Única fuente de la regla de participación. El módulo de auth la consulta antes de firmar un token de suscripción por canal.', ubicacion: 'services/api/src/chat/chat-participation.service.ts', estado: 'hecho' },
    REPO: { title: 'ChatRepository', tipo: 'Repositorio', descripcion: 'SQL parametrizado. Envío serializado bajo bloqueo de la fila de conversación: verifica OPEN, deduplica por (conversation_id, client_message_id), asigna sequence_number e inserta en la misma transacción.', tecnologia: 'PostgreSQL', ubicacion: 'services/api/src/chat/chat.repository.ts', estado: 'hecho' },
    ESCUCHA: { title: 'OfferTerminalChatListener', tipo: 'Listener de eventos', descripcion: 'Cierra las conversaciones de una oferta cuando pasa a CANCELLED, EXPIRED o COMPLETED. Idempotente y best-effort.', ubicacion: 'services/api/src/chat/listeners/offer-terminal-chat.listener.ts', consume: ['offer CANCELLED', 'offer EXPIRED', 'offer COMPLETED'], estado: 'hecho' },
    NEGOCIA: { title: 'NegotiationRepository', tipo: 'Repositorio', descripcion: 'isThreadMatched: una conversación solo existe para un hilo con una propuesta ACCEPTED.', ubicacion: 'services/api/src/negotiation/negotiation.repository.ts', estado: 'hecho' },
    AUTH_TOKEN: { title: 'GET /auth/centrifugo/token', tipo: 'Endpoint de auth', descripcion: 'Auth firma los tokens de conexión y de suscripción; el chat solo aporta la regla de participante. Con channel=chat:conversation:{id} solo se emite a participantes.', ubicacion: 'services/api/src/auth', estado: 'hecho' },
    DB_CHAT: { title: 'chat_conversations / chat_messages', tipo: 'Tablas PostgreSQL', descripcion: 'Una conversación por hilo emparejado; mensajes ordenados por sequence_number (únicos y crecientes, con huecos permitidos). Los FK de participantes son ON DELETE SET NULL.', tecnologia: 'PostgreSQL (migración 1700000019000-CreateChatTables)', ubicacion: 'services/api/src/chat/entities', estado: 'hecho' },
    OUTBOX_CHAT: { title: 'chat_outbox', tipo: 'Tabla outbox', descripcion: 'Evento message-created escrito en la misma transacción del mensaje (TEXT y VOICE). event_id = message:<messageId>:message-created.', ubicacion: 'services/api/src/chat/chat-outbox.ts', produce: ['message-created'], estado: 'hecho' },
    CENTRI: { title: 'Centrifugo', tipo: 'Servicio de tiempo real', descripcion: 'Transporte WebSocket por conversación. Solo transporte: la verdad está en PostgreSQL y el cliente reconcilia por historial.', tecnologia: 'Centrifugo (ws.bidclean.tech)', ubicacion: 'services/api/src/offers/delivery/centrifugo.client.ts', estado: 'hecho' },
    RELE_NOTIF: { title: 'NotificationsModule', tipo: 'Módulo NestJS', descripcion: 'El outbox-relay lee chat_outbox y crea la intención de push para la contraparte (mapper chat-outbox.mapper.ts).', ubicacion: 'services/api/src/notifications/mappers/chat-outbox.mapper.ts', consume: ['message-created'], estado: 'parcial', nota: 'Faltan credenciales de OneSignal.' },
    TRADUCE: { title: 'LibreTranslate', tipo: 'Servicio externo propio', descripcion: 'Traducción automática de mensajes. El contenedor está definido en infra/docker-compose.yml, pero no existe código en la API ni router en el servicio de IA que lo use.', tecnologia: 'LibreTranslate (auto-hospedado)', ubicacion: 'infra/docker-compose.yml', estado: 'falta', nota: 'Sin integración en el chat; el router de traducción de services/ai/src/main.py sigue comentado.' },
    GRABA: { title: 'useVoiceRecorder', tipo: 'Hook móvil', descripcion: 'Ciclo de grabación con expo-av: inicio y fin con tiempo transcurrido, auto-stop por duración máxima, previsualizar o descartar, y degradación elegante si se niega el micrófono.', tecnologia: 'expo-av', ubicacion: 'apps/mobile/src/screens/chat/useVoiceRecorder.ts', estado: 'hecho' },
    VOZ_API: { title: 'voice.api', tipo: 'Cliente HTTP móvil', descripcion: 'Acción compuesta: pide upload-url, hace PUT directo a MinIO y envía el mensaje VOICE. También requestPlaybackUrl.', ubicacion: 'apps/mobile/src/screens/chat/voice.api.ts', estado: 'hecho' },
    URL_SUBIDA: { title: 'POST voice-notes/upload-url', tipo: 'Endpoint REST', descripcion: 'Exige participante y conversación OPEN. Persiste la grant y devuelve { objectKey, uploadUrl, expiresAt } con un PUT firmado de un solo objeto. El cliente nunca elige la clave.', ubicacion: 'services/api/src/chat/chat.controller.ts', estado: 'hecho' },
    GRANT: { title: 'voice_note_upload_grants', tipo: 'Tabla PostgreSQL', descripcion: 'Liga la clave del objeto (PK) a una conversación y al usuario emisor; un solo uso y vencimiento corto. Poseer la clave no autoriza nada.', ubicacion: 'services/api/src/chat/voice/entities/voice-note-upload-grant.entity.ts', estado: 'hecho' },
    MINIO: { title: 'MinIO · chat-voice-notes', tipo: 'Almacenamiento de objetos', descripcion: 'Bucket privado con los bytes del audio. Solo se accede con URLs prefirmadas de corta vida (PUT y GET).', tecnologia: 'MinIO (storage.bidclean.tech)', ubicacion: 'services/api/src/chat/voice/voice-note-storage.service.ts', estado: 'hecho' },
    ENVIA_VOZ: { title: 'ChatService.sendVoiceMessage', tipo: 'Servicio NestJS', descripcion: 'Rama VOICE del envío serializado: deduplica, verifica OPEN y la grant, inspecciona el objeto de forma autoritativa y crea mensaje, metadatos y consumo de la grant de forma atómica; luego publica y encola la transcripción.', ubicacion: 'services/api/src/chat/chat.service.ts', produce: ['message-created'], adr: 'ADR-012', estado: 'hecho' },
    SONDA: { title: 'AudioDurationProbe', tipo: 'Proveedor NestJS', descripcion: 'Duración leída de las cabeceras del audio (WAV, MPEG). Si no puede confirmar un audio válido devuelve null y el envío se rechaza con 400.', ubicacion: 'services/api/src/chat/voice/audio-duration.probe.ts', estado: 'hecho' },
    DB_VOZ: { title: 'chat_voice_notes', tipo: 'Tabla PostgreSQL', descripcion: 'Metadatos 1 a 1 de un mensaje VOICE: objectKey único, duración, tamaño y mime observados por el servidor, estado de transcripción y un contador transcript_attempt monotónico.', ubicacion: 'services/api/src/chat/voice/entities/chat-voice-note.entity.ts', estado: 'hecho' },
    COLA_TRANS: { title: 'Cola voice-notes-transcription', tipo: 'Cola BullMQ', descripcion: 'Trabajo transcribe-voice-note con reintentos y backoff exponencial configurables.', tecnologia: 'BullMQ + Redis', ubicacion: 'services/api/src/chat/voice/voice.constants.ts', estado: 'hecho' },
    PROC_TRANS: { title: 'VoiceTranscriptionProcessor', tipo: 'Worker BullMQ', descripcion: 'Reclama un intento, descarga el objeto, llama a Whisper y adjunta el resultado solo si el intento es el más reciente. onFailed marca FAILED al agotar reintentos.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/chat/voice/voice-transcription.processor.ts', produce: ['voice_transcript_updated'], estado: 'parcial', nota: 'El motor real de Whisper.cpp no está conectado: hoy el flujo termina en FAILED.' },
    WHISPER: { title: 'WhisperClient', tipo: 'Cliente HTTP', descripcion: 'Envía los bytes en multipart a /transcribe con reintento exponencial acotado. Clasifica errores transitorios (5xx, red) y deterministas (4xx).', ubicacion: 'services/api/src/chat/voice/whisper.client.ts', estado: 'hecho' },
    IA_TRANSCRIBE: { title: 'IA POST /transcribe', tipo: 'Endpoint FastAPI', descripcion: 'Recibe bytes de audio y devuelve { text, language }. Autenticación servicio a servicio con token Bearer.', tecnologia: 'FastAPI', ubicacion: 'services/ai/src/speech/router.py', estado: 'parcial', nota: 'El router y el servicio existen; el motor por defecto es NotConfiguredEngine.' },
    MOTOR: { title: 'NotConfiguredEngine', tipo: 'Motor de transcripción', descripcion: 'Motor de reemplazo: lanza UnusableAudioError (422) mientras no se enlace el binario de Whisper.cpp. Por eso la transcripción real aún no funciona.', tecnologia: 'Whisper.cpp (pendiente)', ubicacion: 'services/ai/src/speech/engine.py', estado: 'falta', nota: 'Falta enlazar Whisper.cpp en la VPS.' },
    CANAL_VOZ: { title: 'voice_transcript_updated', tipo: 'Evento en tiempo real', descripcion: 'Actualización del mensaje publicada en el mismo canal de la conversación. No hay un canal nuevo.', tecnologia: 'Centrifugo', ubicacion: 'services/api/src/chat/voice/voice-transcription.processor.ts', estado: 'hecho' },
    REPRODUCE: { title: 'VoiceNotePlayer', tipo: 'Componente móvil', descripcion: 'Play/pausa, duración y onda. La transcripción se muestra según su estado (READY, PENDING, FAILED, DISABLED) sin bloquear nunca la reproducción.', ubicacion: 'apps/mobile/src/screens/chat/components/VoiceNotePlayer.tsx', estado: 'hecho' },
    URL_REPRO: { title: 'GET playback-url', tipo: 'Endpoint REST', descripcion: 'Resuelve la clave desde la BD por messageId (nunca del cliente) y devuelve una URL GET prefirmada de corta vida, solo para participantes.', ubicacion: 'services/api/src/chat/chat.controller.ts', estado: 'hecho' },
    TOMBA: { title: 'voice_note_object_deletions', tipo: 'Tabla PostgreSQL', descripcion: 'Tombstones: un trigger BEFORE DELETE en chat_voice_notes copia la clave liberada en la misma transacción para borrar el objeto de MinIO después.', ubicacion: 'services/api/src/chat/voice/entities/voice-note-object-deletion.entity.ts', estado: 'hecho' },
    LIMPIEZA: { title: 'VoiceNoteCleanupProcessor', tipo: 'Worker programado', descripcion: 'Cuatro barridos idempotentes: grants vencidas y objetos huérfanos, drenaje de tombstones, reconciliador de objetos sin referencia y re-encolado de transcripciones PENDING atascadas.', tecnologia: 'BullMQ (voice-notes-cleanup) + @nestjs/schedule', ubicacion: 'services/api/src/chat/voice/voice-note-cleanup.processor.ts', estado: 'hecho' },
  },
  sections: [
    {
      title: 'Endpoints de chat y notas de voz',
      html: `<table>
<thead><tr><th>Método</th><th>Ruta</th><th>Descripción</th></tr></thead>
<tbody>
<tr><td>POST</td><td><code>/chat/threads/:threadId/conversation</code></td><td>Abre u obtiene la conversación de un hilo emparejado (idempotente).</td></tr>
<tr><td>GET</td><td><code>/chat/conversations</code></td><td>Bandeja del usuario, ordenada por last_message_at descendente.</td></tr>
<tr><td>GET</td><td><code>/chat/conversations/:id</code></td><td>Una conversación (solo participantes).</td></tr>
<tr><td>GET</td><td><code>/chat/conversations/:id/messages</code></td><td>Historial por cursor: <code>before</code> (hacia atrás) o <code>after</code> (reconciliación).</td></tr>
<tr><td>POST</td><td><code>/chat/conversations/:id/messages</code></td><td>Envía TEXT o VOICE. Exige cabecera Idempotency-Key y clientMessageId.</td></tr>
<tr><td>POST</td><td><code>/chat/conversations/:id/voice-notes/upload-url</code></td><td>Emite la grant y la URL PUT prefirmada hacia MinIO.</td></tr>
<tr><td>GET</td><td><code>/chat/conversations/:id/voice-notes/:messageId/playback-url</code></td><td>URL GET prefirmada de corta vida para reproducir.</td></tr>
<tr><td>GET</td><td><code>/auth/centrifugo/token</code></td><td>Token de conexión; con <code>channel</code> emite el de suscripción (solo participantes).</td></tr>
<tr><td>POST</td><td><code>/transcribe</code> (servicio IA)</td><td>Transcribe bytes de audio; hoy responde error por NotConfiguredEngine.</td></tr>
</tbody></table>`,
    },
    {
      title: 'Pantallas y archivos móviles',
      html: `<ul>
<li><code>apps/mobile/src/screens/chat/ChatEntryScreen.tsx</code>, <code>ChatScreen.tsx</code></li>
<li><code>chat.store.ts</code>, <code>chat.api.ts</code>, <code>voice.api.ts</code>, <code>useChatChannel.ts</code>, <code>useVoiceRecorder.ts</code></li>
<li><code>components/ConversationHeader.tsx</code>, <code>MessageBubble.tsx</code>, <code>MessageComposer.tsx</code>, <code>VoiceNotePlayer.tsx</code></li>
</ul>`,
    },
  ],
});
