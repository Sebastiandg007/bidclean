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
} from './chat.repository';
import {
  ConversationStatus,
  ConversationSummaryView,
  ConversationView,
  MessagePage,
  MessageType,
  MessageView,
  SendResult,
} from './chat.types';
import { ChatConversation } from './entities/chat-conversation.entity';
import { ChatMessage } from './entities/chat-message.entity';

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
    return { messages: messages.map((m) => this.toMessageView(m)), hasMore: messages.length === limit };
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
    return { messages: messages.map((m) => this.toMessageView(m)), hasMore: messages.length === limit };
  }

  /** Send a message: validate, persist (serialized), then publish best-effort. */
  async sendMessage(
    conversationId: string,
    userId: string,
    clientMessageId: string,
    body: string,
  ): Promise<SendResult> {
    await this.requireParticipantConversation(conversationId, userId);
    const trimmed = this.validateBody(body);

    const outcome = await this.chatRepository.insertMessage({
      conversationId,
      senderId: userId,
      clientMessageId,
      body: trimmed,
    });
    const result = this.interpretOutcome(outcome);

    if (!result.deduplicated) {
      await this.publishBestEffort(conversationId, result.message);
    }
    return result;
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

  private toMessageView(message: ChatMessage): MessageView {
    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      type: message.type as MessageType,
      body: message.body,
      sequenceNumber: message.sequenceNumber,
      clientMessageId: message.clientMessageId,
      createdAt: message.createdAt.toISOString(),
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
