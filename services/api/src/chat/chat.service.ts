import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { NegotiationRepository } from '../negotiation/negotiation.repository';
import { chatChannelForConversation, CHAT_MESSAGE_MAX_LENGTH, CHAT_HISTORY_PAGE_SIZE } from './chat.constants';
import { CHAT_ERROR_MESSAGES } from './chat.messages';
import {
  ChatRepository,
  ConversationInboxRow,
  InsertMessageOutcome,
  InsertVoiceMessageOutcome,
  VoiceObjectCheck,
} from './chat.repository';
import {
  ConversationStatus,
  ConversationSummaryView,
  ConversationView,
  MessagePage,
  MessageType,
  MessageView,
  SendResult,
  TranscriptStatus,
  VoiceNoteView,
} from './chat.types';
import { ChatConversation } from './entities/chat-conversation.entity';
import { ChatMessage } from './entities/chat-message.entity';
import {
  VOICE_ALLOWED_MIME_TYPES,
  VOICE_MAX_DURATION_MS,
  VOICE_MAX_SIZE_BYTES,
  VOICE_TRANSCRIPTION_ENABLED,
  VOICE_TRANSCRIPTION_JOB_NAME,
} from './voice/voice.constants';
import { UploadGrantRepository } from './voice/upload-grant.repository';
import { VoiceNoteRepository } from './voice/voice-note.repository';
import { VoiceNoteStorageService } from './voice/voice-note-storage.service';
import { ChatVoiceNote } from './voice/entities/chat-voice-note.entity';
import {
  buildVoiceFingerprint,
  fingerprintsEqual,
  PlaybackTarget,
  SendVoiceParams,
  UploadTarget,
  VOICE_ERROR_MESSAGES,
} from './voice/voice.types';

/**
 * Realtime publisher seam — the subset of `CentrifugoClient` the chat service needs.
 * Kept as an interface so the service is testable without the HTTP client, and so publishing
 * stays a best-effort transport concern the service never awaits for correctness.
 */
export interface ChatRealtimePublisher {
  publish(channel: string, data: unknown): Promise<boolean>;
}

/** Injection token for the realtime publisher (bound to CentrifugoClient in the module). */
export const CHAT_REALTIME_PUBLISHER = Symbol('CHAT_REALTIME_PUBLISHER');

/**
 * Best-effort transcription enqueue seam — the subset of a BullMQ queue the chat service needs.
 * Kept as an interface + injection token so the service never depends on the queue implementation
 * and an enqueue failure (recovered by the stuck-PENDING sweep) never fails a durable send.
 */
export interface VoiceTranscriptionEnqueuer {
  add(name: string, data: unknown): Promise<unknown>;
}

/** Injection token for the transcription enqueuer (bound to the BullMQ queue in the module). */
export const VOICE_TRANSCRIPTION_ENQUEUER = Symbol('VOICE_TRANSCRIPTION_ENQUEUER');

/** Parameters for opening a conversation for a matched thread. */
export interface OpenConversationInput {
  readonly threadId: string;
  readonly userId: string;
}

/**
 * ChatService — orchestrates the chat domain.
 *
 * Opening a conversation requires the thread to be MATCHED (an ACCEPTED proposal). Reading/writing
 * requires the caller to be a participant. Sending validates the body, then delegates to the
 * repository's serialized transaction (which enforces the OPEN-lifecycle inside the row lock, so
 * there is no check-then-act race with a concurrent close) and afterward publishes best-effort to
 * Centrifugo — a publish failure never fails the request nor loses the message (PostgreSQL is the
 * source of truth). Message bodies are never logged verbatim.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly chatRepository: ChatRepository,
    private readonly negotiationRepository: NegotiationRepository,
    @Inject(CHAT_REALTIME_PUBLISHER)
    private readonly publisher: ChatRealtimePublisher,
    private readonly grantRepository: UploadGrantRepository,
    private readonly voiceNoteRepository: VoiceNoteRepository,
    private readonly voiceStorage: VoiceNoteStorageService,
    @Inject(VOICE_TRANSCRIPTION_ENQUEUER)
    private readonly transcriptionQueue: VoiceTranscriptionEnqueuer,
  ) {}

  /** Open (or fetch) the conversation for a matched thread the caller participates in. */
  async openConversation(input: OpenConversationInput): Promise<ConversationView> {
    const thread = await this.negotiationRepository.findThreadById(input.threadId);
    if (!thread) {
      throw new NotFoundException(CHAT_ERROR_MESSAGES.THREAD_NOT_MATCHED);
    }
    if (input.userId !== thread.hostId && input.userId !== thread.cleanerId) {
      throw new ForbiddenException(CHAT_ERROR_MESSAGES.NOT_A_PARTICIPANT);
    }
    const matched = await this.negotiationRepository.isThreadMatched(input.threadId);
    if (!matched) {
      throw new ConflictException(CHAT_ERROR_MESSAGES.THREAD_NOT_MATCHED);
    }

    const conversation = await this.chatRepository.openOrGetConversationForThread({
      threadId: thread.id,
      offerId: thread.offerId,
      hostId: thread.hostId,
      cleanerId: thread.cleanerId,
    });
    return this.toConversationView(conversation);
  }

  /** Return a conversation the caller participates in. */
  async getConversation(conversationId: string, userId: string): Promise<ConversationView> {
    const conversation = await this.requireParticipantConversation(conversationId, userId);
    return this.toConversationView(conversation);
  }

  /** List the caller's conversations, most-recent first. */
  async listConversations(userId: string): Promise<ConversationSummaryView[]> {
    const rows = await this.chatRepository.listConversationsForUser(
      userId,
      CHAT_HISTORY_PAGE_SIZE,
    );
    return rows.map((row) => this.toSummaryView(row));
  }

  /** Older-message page (backward scroll); `beforeSeq` null returns the latest page. */
  async getMessagesBefore(
    conversationId: string,
    userId: string,
    beforeSeq: number | null,
    limit: number,
  ): Promise<MessagePage> {
    await this.requireParticipantConversation(conversationId, userId);
    const messages = await this.chatRepository.getMessagesBefore(
      conversationId,
      beforeSeq,
      limit,
    );
    return { messages: await this.toMessageViews(messages), hasMore: messages.length === limit };
  }

  /** Newer-message page (reconnect reconciliation) strictly after `afterSeq`. */
  async getMessagesAfter(
    conversationId: string,
    userId: string,
    afterSeq: number,
    limit: number,
  ): Promise<MessagePage> {
    await this.requireParticipantConversation(conversationId, userId);
    const messages = await this.chatRepository.getMessagesAfter(conversationId, afterSeq, limit);
    return { messages: await this.toMessageViews(messages), hasMore: messages.length === limit };
  }

  /** Send a message: validate, persist (serialized), then publish best-effort. */
  async sendMessage(
    conversationId: string,
    userId: string,
    clientMessageId: string,
    body: string,
  ): Promise<SendResult> {
    const conversation = await this.requireParticipantConversation(conversationId, userId);
    const trimmed = this.validateBody(body);

    const outcome = await this.chatRepository.insertMessage({
      conversationId,
      senderId: userId,
      clientMessageId,
      body: trimmed,
      recipientUserId: this.otherParticipant(conversation, userId),
    });
    const result = this.interpretOutcome(outcome);

    if (!result.deduplicated) {
      await this.publishBestEffort(conversationId, result.message);
    }
    return result;
  }

  /**
   * Issue an upload target for a voice note: verify participant + OPEN, PERSIST the grant BEFORE
   * minting the pre-signed PUT URL (so a mint failure still leaves a sweepable grant), and return
   * the opaque key + short-lived URL. The client never chooses the key.
   */
  async createVoiceUploadTarget(
    conversationId: string,
    userId: string,
  ): Promise<UploadTarget> {
    const conversation = await this.requireParticipantConversation(conversationId, userId);
    if (conversation.status !== ConversationStatus.OPEN) {
      throw new ConflictException(CHAT_ERROR_MESSAGES.CONVERSATION_CLOSED);
    }

    const objectKey = this.voiceStorage.generateObjectKey();
    await this.grantRepository.createGrant({ objectKey, conversationId, userId });
    return this.voiceStorage.presignUploadTarget(objectKey);
  }

  /**
   * Send a voice note: reuse the Spec 13 serialized transaction with the voice steps woven in
   * (grant verify, authoritative object inspection, atomic message + metadata + grant consume),
   * then best-effort publish + best-effort transcription enqueue (only when STT enabled). Neither
   * audio bytes nor a transcript are ever logged.
   */
  async sendVoiceMessage(params: SendVoiceParams): Promise<SendResult> {
    const conversation = await this.requireParticipantConversation(
      params.conversationId,
      params.senderId,
    );
    const incoming = buildVoiceFingerprint(params);

    const outcome = await this.chatRepository.insertVoiceMessage(
      {
        conversationId: params.conversationId,
        senderId: params.senderId,
        clientMessageId: params.clientMessageId,
        recipientUserId: this.otherParticipant(conversation, params.senderId),
      },
      {
        fingerprintMatches: async (manager, existingMessageId) => {
          const existing = await manager
            .getRepository(ChatVoiceNote)
            .findOne({ where: { messageId: existingMessageId } });
          if (!existing) {
            return false;
          }
          return fingerprintsEqual(incoming, {
            objectKey: existing.objectKey,
            durationMs: existing.durationMs,
            sizeBytes: existing.sizeBytes,
            mimeType: existing.mimeType,
            waveform: existing.waveform,
          });
        },
        verifyGrant: async (manager) => {
          const grant = await this.grantRepository.findConsumable(manager, params.objectKey);
          if (
            !grant ||
            grant.conversationId !== params.conversationId ||
            grant.issuedToUserId !== params.senderId
          ) {
            return { ok: false, reason: 'forbidden' };
          }
          if (grant.status !== 'ISSUED' || grant.expiresAt.getTime() <= Date.now()) {
            return { ok: false, reason: 'unusable' };
          }
          return { ok: true };
        },
        inspectObject: () => this.inspectVoiceObject(params.objectKey),
        insertVoiceNote: (manager, messageId, observed) =>
          this.voiceNoteRepository.insertVoiceNote(manager, {
            messageId,
            objectKey: params.objectKey,
            durationMs: observed.durationMs,
            sizeBytes: observed.sizeBytes,
            mimeType: observed.contentType,
            waveform: params.waveform,
            transcriptStatus: VOICE_TRANSCRIPTION_ENABLED
              ? TranscriptStatus.PENDING
              : TranscriptStatus.DISABLED,
          }),
        consumeGrant: (manager, messageId) =>
          this.grantRepository.markConsumed(manager, params.objectKey, messageId),
      },
    );

    const result = this.interpretVoiceOutcome(outcome);
    const note = await this.voiceNoteRepository.findByMessageId(result.message.id);
    const hydrated: SendResult = {
      deduplicated: result.deduplicated,
      message: note
        ? { ...result.message, voiceNote: this.toVoiceNoteView(note) }
        : result.message,
    };
    if (!hydrated.deduplicated) {
      await this.publishBestEffort(params.conversationId, hydrated.message);
      await this.enqueueTranscriptionBestEffort(hydrated.message.id);
    }
    return hydrated;
  }

  /**
   * Mint a fresh short-lived playback URL for a voice note. Authorization is by conversation
   * participation; the object key is resolved FROM THE DB by message id (never client-supplied).
   */
  async getVoicePlaybackTarget(
    conversationId: string,
    userId: string,
    messageId: string,
  ): Promise<PlaybackTarget> {
    await this.requireParticipantConversation(conversationId, userId);
    const voiceNote = await this.voiceNoteRepository.findByMessageId(messageId);
    if (!voiceNote || voiceNote.messageId !== messageId) {
      throw new NotFoundException(VOICE_ERROR_MESSAGES.NOT_A_VOICE_NOTE);
    }
    return this.voiceStorage.getPlaybackTarget(voiceNote.objectKey);
  }

  /** Close the conversation for a thread whose match was invalidated. Idempotent. */
  async closeConversationForThread(threadId: string): Promise<void> {
    await this.chatRepository.closeConversationForThread(threadId);
  }

  /** Close every conversation for a terminal offer. Idempotent (offer-terminal lifecycle). */
  async closeConversationsForOffer(offerId: string): Promise<void> {
    await this.chatRepository.closeConversationsForOffer(offerId);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Authoritatively inspect a stored object against the configured bounds. The storage layer
   * reports the real size/content-type/duration; this maps them to a pass or a typed rejection.
   * Client-declared metadata is never consulted here.
   */
  private async inspectVoiceObject(objectKey: string): Promise<VoiceObjectCheck> {
    const inspection = await this.voiceStorage.inspectObject(objectKey);
    if (!inspection.exists) {
      return { ok: false, reason: 'missing' };
    }
    if (inspection.sizeBytes > VOICE_MAX_SIZE_BYTES) {
      return { ok: false, reason: 'too_large' };
    }
    if (!VOICE_ALLOWED_MIME_TYPES.includes(inspection.contentType)) {
      return { ok: false, reason: 'invalid_type' };
    }
    // An unprobeable object (durationMs === null) is treated as invalid audio, never unbounded.
    if (inspection.durationMs === null || inspection.durationMs > VOICE_MAX_DURATION_MS) {
      return { ok: false, reason: 'too_long' };
    }
    return {
      ok: true,
      observed: {
        sizeBytes: inspection.sizeBytes,
        contentType: inspection.contentType,
        durationMs: inspection.durationMs,
      },
    };
  }

  /** Map a serialized VOICE send outcome to a result or the appropriate HTTP error. */
  private interpretVoiceOutcome(outcome: InsertVoiceMessageOutcome): SendResult {
    switch (outcome.kind) {
      case 'inserted':
        return { message: this.toMessageView(outcome.message), deduplicated: false };
      case 'duplicate':
        return { message: this.toMessageView(outcome.message), deduplicated: true };
      case 'conflict':
        throw new ConflictException(VOICE_ERROR_MESSAGES.FINGERPRINT_CONFLICT);
      case 'closed':
        throw new ConflictException(CHAT_ERROR_MESSAGES.CONVERSATION_CLOSED);
      case 'not_found':
        throw new NotFoundException(CHAT_ERROR_MESSAGES.CONVERSATION_NOT_FOUND);
      case 'grant_forbidden':
        throw new ForbiddenException(VOICE_ERROR_MESSAGES.GRANT_NOT_FOUND);
      case 'grant_unusable':
        throw new ConflictException(VOICE_ERROR_MESSAGES.GRANT_UNUSABLE);
      case 'object_missing':
        throw new BadRequestException(VOICE_ERROR_MESSAGES.OBJECT_MISSING);
      case 'object_too_large':
        throw new BadRequestException(VOICE_ERROR_MESSAGES.OBJECT_TOO_LARGE);
      case 'object_invalid_type':
        throw new BadRequestException(VOICE_ERROR_MESSAGES.OBJECT_INVALID_TYPE);
      case 'duration_too_long':
        throw new BadRequestException(VOICE_ERROR_MESSAGES.DURATION_TOO_LONG);
    }
  }

  /**
   * Best-effort enqueue of a transcription job after a durable send. Only when STT is enabled; a
   * failure never fails the send (the stuck-PENDING sweep recovers a lost enqueue). Never logs the
   * transcript/audio.
   */
  private async enqueueTranscriptionBestEffort(messageId: string): Promise<void> {
    if (!VOICE_TRANSCRIPTION_ENABLED) {
      return;
    }
    try {
      await this.transcriptionQueue.add(VOICE_TRANSCRIPTION_JOB_NAME, { messageId });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`Transcription enqueue failed for message ${messageId}: ${reason}`);
    }
  }

  /** Map a repository send outcome to a result or the appropriate HTTP error. */
  private interpretOutcome(outcome: InsertMessageOutcome): SendResult {
    switch (outcome.kind) {
      case 'inserted':
        return { message: this.toMessageView(outcome.message), deduplicated: false };
      case 'duplicate':
        return { message: this.toMessageView(outcome.message), deduplicated: true };
      case 'conflict':
        throw new ConflictException(CHAT_ERROR_MESSAGES.CLIENT_MESSAGE_ID_CONFLICT);
      case 'closed':
        throw new ConflictException(CHAT_ERROR_MESSAGES.CONVERSATION_CLOSED);
      case 'not_found':
        throw new NotFoundException(CHAT_ERROR_MESSAGES.CONVERSATION_NOT_FOUND);
    }
  }

  /** Validate + trim a message body. Never logs or echoes the body content. */
  private validateBody(body: string): string {
    const trimmed = body?.trim() ?? '';
    if (trimmed.length === 0) {
      throw new BadRequestException(CHAT_ERROR_MESSAGES.EMPTY_BODY);
    }
    if (trimmed.length > CHAT_MESSAGE_MAX_LENGTH) {
      throw new BadRequestException(CHAT_ERROR_MESSAGES.BODY_TOO_LONG);
    }
    return trimmed;
  }

  /** Load a conversation and assert the caller participates, else 404/403. */
  private async requireParticipantConversation(
    conversationId: string,
    userId: string,
  ): Promise<ChatConversation> {
    const conversation = await this.chatRepository.findConversationById(conversationId);
    if (!conversation) {
      throw new NotFoundException(CHAT_ERROR_MESSAGES.CONVERSATION_NOT_FOUND);
    }
    if (userId !== conversation.hostId && userId !== conversation.cleanerId) {
      throw new ForbiddenException(CHAT_ERROR_MESSAGES.NOT_A_PARTICIPANT);
    }
    return conversation;
  }

  /** The other participant of a two-party conversation relative to `userId` (push recipient). */
  private otherParticipant(conversation: ChatConversation, userId: string): string {
    const other = userId === conversation.hostId ? conversation.cleanerId : conversation.hostId;
    if (!other) {
      // Both participants are present for any conversation that accepts a send; a null here means
      // the counterparty was deleted/anonymized (FK SET NULL) — treat as a data-integrity break.
      throw new ConflictException(CHAT_ERROR_MESSAGES.CONVERSATION_CLOSED);
    }
    return other;
  }

  /** Publish a persisted message to its channel; swallow failures (transport is best-effort). */
  private async publishBestEffort(conversationId: string, message: MessageView): Promise<void> {
    try {
      await this.publisher.publish(chatChannelForConversation(conversationId), {
        type: 'chat_message',
        message,
      });
    } catch (error) {
      // Never fail the send on a transport error; recipients reconcile via the `after` cursor.
      const reason = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`Chat publish failed for conversation ${conversationId}: ${reason}`);
    }
  }

  private toMessageView(message: ChatMessage, voiceNote?: VoiceNoteView): MessageView {
    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      type: message.type as MessageType,
      body: message.body,
      sequenceNumber: message.sequenceNumber,
      clientMessageId: message.clientMessageId,
      createdAt: message.createdAt.toISOString(),
      ...(voiceNote ? { voiceNote } : {}),
    };
  }

  /**
   * Hydrate a page of messages into views, attaching the voice-note payload to each VOICE message
   * (batch-loaded by message id so history is complete from PostgreSQL alone, independent of
   * realtime and transcript availability).
   */
  private async toMessageViews(messages: ChatMessage[]): Promise<MessageView[]> {
    const voiceIds = messages
      .filter((m) => m.type === MessageType.VOICE)
      .map((m) => m.id);
    const notesById = await this.loadVoiceNotesByMessageId(voiceIds);
    return messages.map((m) => {
      const note = notesById.get(m.id);
      return this.toMessageView(m, note ? this.toVoiceNoteView(note) : undefined);
    });
  }

  /** Batch-load voice-note rows keyed by message id. */
  private async loadVoiceNotesByMessageId(
    messageIds: string[],
  ): Promise<Map<string, ChatVoiceNote>> {
    const map = new Map<string, ChatVoiceNote>();
    for (const messageId of messageIds) {
      const note = await this.voiceNoteRepository.findByMessageId(messageId);
      if (note) {
        map.set(messageId, note);
      }
    }
    return map;
  }

  /** Project a voice-note row to its client view (the raw object key is never exposed). */
  private toVoiceNoteView(note: ChatVoiceNote): VoiceNoteView {
    return {
      durationMs: note.durationMs,
      sizeBytes: note.sizeBytes,
      mimeType: note.mimeType,
      waveform: note.waveform,
      transcript: note.transcript,
      transcriptStatus: note.transcriptStatus as TranscriptStatus,
      transcriptLang: note.transcriptLang,
      transcriptAttempt: note.transcriptAttempt,
    };
  }

  private toConversationView(conversation: ChatConversation): ConversationView {
    return {
      id: conversation.id,
      threadId: conversation.threadId,
      offerId: conversation.offerId,
      hostId: conversation.hostId,
      cleanerId: conversation.cleanerId,
      status: conversation.status as ConversationStatus,
      lastMessageAt: conversation.lastMessageAt ? conversation.lastMessageAt.toISOString() : null,
      createdAt: conversation.createdAt.toISOString(),
    };
  }

  private toSummaryView(row: ConversationInboxRow): ConversationSummaryView {
    return {
      id: row.id,
      threadId: row.thread_id,
      offerId: row.offer_id,
      hostId: row.host_id,
      cleanerId: row.cleaner_id,
      status: row.status as ConversationStatus,
      lastMessageAt: row.last_message_at ? new Date(row.last_message_at).toISOString() : null,
      createdAt: new Date(row.created_at).toISOString(),
      lastMessagePreview: row.last_message_preview,
    };
  }
}
