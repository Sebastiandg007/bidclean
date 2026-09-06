/**
 * realtime-chat domain types.
 *
 * View shapes returned by the service/controller and the internal result of a send. These are
 * the API-facing contracts the mobile client mirrors; message bodies are plain user text and are
 * never logged verbatim.
 */

/** Conversation lifecycle status. */
export const ConversationStatus = { OPEN: 'OPEN', CLOSED: 'CLOSED' } as const;
export type ConversationStatus =
  (typeof ConversationStatus)[keyof typeof ConversationStatus];

/** Message type discriminator: TEXT or VOICE (voice notes, Spec 14). */
export const MessageType = { TEXT: 'TEXT', VOICE: 'VOICE' } as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

/**
 * Transcript lifecycle for a voice note: PENDING (queued/in progress), READY (attached),
 * FAILED (STT could not produce one), DISABLED (STT off by configuration). Derived data — never
 * authoritative and never a gate on send/playback.
 */
export const TranscriptStatus = {
  PENDING: 'PENDING',
  READY: 'READY',
  FAILED: 'FAILED',
  DISABLED: 'DISABLED',
} as const;
export type TranscriptStatus =
  (typeof TranscriptStatus)[keyof typeof TranscriptStatus];

/**
 * The voice-note payload attached to a `VOICE` message view: server-observed audio metadata plus
 * the derived transcript state. The raw `objectKey` is never exposed to clients — playback is
 * obtained via a short-lived participant-gated pre-signed URL endpoint.
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

/**
 * A single message as returned to clients. `body` is the text for `TEXT` messages and `null` for
 * `VOICE` messages; a `VOICE` message instead carries a `voiceNote` payload.
 */
export interface MessageView {
  readonly id: string;
  readonly conversationId: string;
  readonly senderId: string | null;
  readonly type: MessageType;
  readonly body: string | null;
  readonly sequenceNumber: number;
  readonly clientMessageId: string;
  readonly createdAt: string;
  readonly voiceNote?: VoiceNoteView;
}

/** A conversation as returned to clients (single or inbox row). */
export interface ConversationView {
  readonly id: string;
  readonly threadId: string;
  readonly offerId: string;
  readonly hostId: string | null;
  readonly cleanerId: string | null;
  readonly status: ConversationStatus;
  readonly lastMessageAt: string | null;
  readonly createdAt: string;
}

/** An inbox row: a conversation plus a preview of its most recent message. */
export interface ConversationSummaryView extends ConversationView {
  readonly lastMessagePreview: string | null;
}

/**
 * Result of a send/insert. `deduplicated` is true when an idempotent retry (same
 * `clientMessageId` + identical payload) returned the pre-existing message rather than inserting.
 */
export interface SendResult {
  readonly message: MessageView;
  readonly deduplicated: boolean;
}

/** A page of messages returned by a keyset (before/after) history read. */
export interface MessagePage {
  readonly messages: readonly MessageView[];
  readonly hasMore: boolean;
}
