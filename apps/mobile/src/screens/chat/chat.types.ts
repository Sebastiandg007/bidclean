/**
 * chat.types — Mobile domain types for realtime chat.
 *
 * Mirrors the backend `chat` contracts (conversation + message views) plus local-only UI state
 * (`sendState`) for optimistic sends. Messages are ordered by `sequenceNumber` and de-duplicated
 * by `id` (server) / `clientMessageId` (own optimistic sends).
 */

/** Conversation lifecycle status (server-authoritative). */
export type ConversationStatus = 'OPEN' | 'CLOSED';

/** Message type discriminator: TEXT or VOICE (voice notes, Spec 14). */
export type MessageType = 'TEXT' | 'VOICE';

/** Local send state for optimistic UI (never persisted server-side). */
export type SendState = 'sending' | 'sent' | 'failed';

/** WebSocket connection status surfaced to the UI. */
export type ConnectionStatus = 'connected' | 'connecting' | 'reconnecting' | 'disconnected';

/**
 * Transcript lifecycle for a voice note (mirrors the backend): PENDING (queued/in progress),
 * READY (attached), FAILED (STT could not produce one), DISABLED (STT off). Derived data — never
 * a gate on playback.
 */
export type TranscriptStatus = 'PENDING' | 'READY' | 'FAILED' | 'DISABLED';

/**
 * The voice-note payload attached to a `VOICE` message: server-observed audio metadata plus the
 * derived transcript state. The raw object key is never exposed — playback is fetched on demand via
 * a short-lived pre-signed URL endpoint.
 */
export interface VoiceNoteView {
  readonly durationMs: number;
  readonly sizeBytes: number;
  readonly mimeType: string;
  readonly waveform: number[] | null;
  readonly transcript: string | null;
  readonly transcriptStatus: TranscriptStatus;
  readonly transcriptLang: string | null;
  readonly transcriptAttempt: number;
}

/** A chat message as held by the client (server fields + optional local send state). */
export interface ChatMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly senderId: string | null;
  readonly type: MessageType;
  /** Text for TEXT messages; null for VOICE messages (whose content is `voiceNote`). */
  readonly body: string | null;
  readonly sequenceNumber: number;
  readonly clientMessageId: string;
  readonly createdAt: string;
  /** Present on VOICE messages: audio metadata + transcript state. */
  readonly voiceNote?: VoiceNoteView;
  /** Local-only: present while a send is in flight or failed; absent once server-confirmed. */
  readonly sendState?: SendState;
  /** Local-only: the recorded audio file URI for an optimistic VOICE send (own playback). */
  readonly localAudioUri?: string;
}

/** A conversation as returned by the backend. */
export interface ChatConversation {
  readonly id: string;
  readonly threadId: string;
  readonly offerId: string;
  readonly hostId: string | null;
  readonly cleanerId: string | null;
  readonly status: ConversationStatus;
  readonly lastMessageAt: string | null;
  readonly createdAt: string;
}

/** An inbox row: a conversation plus a last-message preview. */
export interface ChatConversationSummary extends ChatConversation {
  readonly lastMessagePreview: string | null;
}

/** Result of a send: the persisted message and whether it was an idempotent duplicate. */
export interface ChatSendResult {
  readonly message: ChatMessage;
  readonly deduplicated: boolean;
}

/** A page of messages from a keyset (before/after) history read. */
export interface ChatMessagePage {
  readonly messages: readonly ChatMessage[];
  readonly hasMore: boolean;
}

/** A realtime message event payload received over the conversation channel. */
export interface ChatMessageEvent {
  readonly type: 'chat_message';
  readonly message: ChatMessage;
}

/** Result of issuing a voice-note upload target (opaque key + short-lived pre-signed PUT URL). */
export interface VoiceUploadTarget {
  readonly objectKey: string;
  readonly uploadUrl: string;
  readonly expiresAt: string;
}

/** Result of requesting a voice-note playback URL (short-lived pre-signed GET). */
export interface VoicePlaybackTarget {
  readonly playbackUrl: string;
  readonly expiresAt: string;
}

/** A locally-recorded clip ready to send (from the recorder). */
export interface RecordedClip {
  readonly uri: string;
  readonly durationMs: number;
  readonly sizeBytes: number;
  readonly mimeType: string;
}

/**
 * A realtime transcript-update event on the conversation channel. Applied by the client upsert by
 * `messageId`, ignoring an older `transcriptAttempt` than one already applied.
 */
export interface ChatTranscriptUpdateEvent {
  readonly type: 'voice_transcript_updated';
  readonly messageId: string;
  readonly transcriptAttempt: number;
  readonly transcriptStatus: TranscriptStatus;
  readonly transcript?: string | null;
  readonly transcriptLang?: string | null;
}
