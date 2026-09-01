import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { ChatConversation } from './entities/chat-conversation.entity';
import { ChatMessage } from './entities/chat-message.entity';

/** Parameters for the serialized message insert. */
export interface InsertMessageParams {
  readonly conversationId: string;
  readonly senderId: string;
  readonly clientMessageId: string;
  readonly body: string;
}

/** Discriminated outcome of a serialized insert. */
export type InsertMessageOutcome =
  | { readonly kind: 'inserted'; readonly message: ChatMessage }
  | { readonly kind: 'duplicate'; readonly message: ChatMessage }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'closed' }
  | { readonly kind: 'not_found' };

/** Parameters to open-or-get a conversation for a matched thread. */
export interface OpenConversationParams {
  readonly threadId: string;
  readonly offerId: string;
  readonly hostId: string;
  readonly cleanerId: string;
}

/**
 * Chat repository.
 *
 * Owns all reads/writes to `chat_conversations` and `chat_messages` with parameterized SQL. The
 * send path (`insertMessage`) is ONE serialized transaction under the conversation row lock:
 * verify OPEN inside the lock, dedup on `(conversation_id, client_message_id)` (identical payload
 * returns the existing row, different payload → conflict), allocate the next `sequence_number`
 * from the row-locked `message_seq` counter, insert, and update `last_message_at` atomically.
 * This closes the check-then-act race with a concurrent close and keeps ordering + summary
 * consistent. Reads use keyset pagination (`before`/`after`) on `(conversation_id,
 * sequence_number)`.
 */
@Injectable()
export class ChatRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Idempotently open (or fetch) the single conversation for a matched thread. The UNIQUE
   * constraint on `thread_id` makes concurrent opens converge on one row.
   */
  async openOrGetConversationForThread(
    params: OpenConversationParams,
  ): Promise<ChatConversation> {
    const existing = await this.findConversationByThread(params.threadId);
    if (existing) {
      return existing;
    }
    return this.dataSource.transaction(async (manager: EntityManager) => {
      const again = await manager
        .getRepository(ChatConversation)
        .findOne({ where: { threadId: params.threadId } });
      if (again) {
        return again;
      }
      const repo = manager.getRepository(ChatConversation);
      const created = repo.create({
        threadId: params.threadId,
        offerId: params.offerId,
        hostId: params.hostId,
        cleanerId: params.cleanerId,
        status: 'OPEN',
        messageSeq: 0,
        lastMessageAt: null,
      });
      return repo.save(created);
    });
  }

  /** Find a conversation by id. */
  async findConversationById(id: string): Promise<ChatConversation | null> {
    return this.dataSource
      .getRepository(ChatConversation)
      .findOne({ where: { id } });
  }

  /** Find a conversation by its thread id. */
  async findConversationByThread(threadId: string): Promise<ChatConversation | null> {
    return this.dataSource
      .getRepository(ChatConversation)
      .findOne({ where: { threadId } });
  }

  /** Whether the user is one of the conversation's two participants. */
  async isParticipant(userId: string, conversationId: string): Promise<boolean> {
    const rows = await this.dataSource.query<{ exists: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM "chat_conversations"
         WHERE "id" = $1 AND ("host_id" = $2 OR "cleaner_id" = $2)
       ) AS exists`,
      [conversationId, userId],
    );
    return rows[0]?.exists === true;
  }

  /**
   * Serialized send: row-lock the conversation, verify OPEN, dedup, allocate sequence, insert,
   * and bump `last_message_at` — all in one transaction (see class doc). Returns a discriminated
   * outcome the service maps to HTTP semantics.
   */
  async insertMessage(params: InsertMessageParams): Promise<InsertMessageOutcome> {
    return this.dataSource.transaction(async (manager: EntityManager) => {
      const locked = await manager.query<
        { message_seq: number; status: string }[]
      >(
        `SELECT "message_seq", "status" FROM "chat_conversations" WHERE "id" = $1 FOR UPDATE`,
        [params.conversationId],
      );
      const conversation = locked[0];
      if (!conversation) {
        return { kind: 'not_found' } as const;
      }

      const existing = await this.findByClientMessageId(
        manager,
        params.conversationId,
        params.clientMessageId,
      );
      if (existing) {
        return existing.body === params.body
          ? ({ kind: 'duplicate', message: existing } as const)
          : ({ kind: 'conflict' } as const);
      }

      if (conversation.status !== 'OPEN') {
        return { kind: 'closed' } as const;
      }

      const nextSeq = conversation.message_seq + 1;
      const messageRepo = manager.getRepository(ChatMessage);
      const message = messageRepo.create({
        conversationId: params.conversationId,
        senderId: params.senderId,
        type: 'TEXT',
        body: params.body,
        sequenceNumber: nextSeq,
        clientMessageId: params.clientMessageId,
      });
      const saved = await messageRepo.save(message);

      await manager.query(
        `UPDATE "chat_conversations"
         SET "message_seq" = $1, "last_message_at" = NOW(), "updated_at" = NOW()
         WHERE "id" = $2`,
        [nextSeq, params.conversationId],
      );

      return { kind: 'inserted', message: saved } as const;
    });
  }

  /** Older messages strictly before `beforeSeq` (newest-first), or the latest page when null. */
  async getMessagesBefore(
    conversationId: string,
    beforeSeq: number | null,
    limit: number,
  ): Promise<ChatMessage[]> {
    const repo = this.dataSource.getRepository(ChatMessage);
    const qb = repo
      .createQueryBuilder('m')
      .where('m.conversation_id = :conversationId', { conversationId });
    if (beforeSeq !== null) {
      qb.andWhere('m.sequence_number < :beforeSeq', { beforeSeq });
    }
    return qb.orderBy('m.sequence_number', 'DESC').take(limit).getMany();
  }

  /** Messages strictly after `afterSeq` (oldest-first), for reconnect reconciliation. */
  async getMessagesAfter(
    conversationId: string,
    afterSeq: number,
    limit: number,
  ): Promise<ChatMessage[]> {
    return this.dataSource
      .getRepository(ChatMessage)
      .createQueryBuilder('m')
      .where('m.conversation_id = :conversationId', { conversationId })
      .andWhere('m.sequence_number > :afterSeq', { afterSeq })
      .orderBy('m.sequence_number', 'ASC')
      .take(limit)
      .getMany();
  }

  /** The caller's conversations ordered by most-recent activity, with a last-message preview. */
  async listConversationsForUser(
    userId: string,
    limit: number,
  ): Promise<ConversationInboxRow[]> {
    return this.dataSource.query<ConversationInboxRow[]>(
      `SELECT
         c."id" AS id,
         c."thread_id" AS thread_id,
         c."offer_id" AS offer_id,
         c."host_id" AS host_id,
         c."cleaner_id" AS cleaner_id,
         c."status" AS status,
         c."last_message_at" AS last_message_at,
         c."created_at" AS created_at,
         m."body" AS last_message_preview
       FROM "chat_conversations" c
       LEFT JOIN LATERAL (
         SELECT "body" FROM "chat_messages"
         WHERE "conversation_id" = c."id"
         ORDER BY "sequence_number" DESC
         LIMIT 1
       ) m ON TRUE
       WHERE c."host_id" = $1 OR c."cleaner_id" = $1
       ORDER BY c."last_message_at" DESC NULLS LAST
       LIMIT $2`,
      [userId, limit],
    );
  }

  /** Close the conversation for a thread when its match is invalidated. Idempotent. */
  async closeConversationForThread(threadId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE "chat_conversations"
       SET "status" = 'CLOSED', "updated_at" = NOW()
       WHERE "thread_id" = $1 AND "status" = 'OPEN'`,
      [threadId],
    );
  }

  /**
   * Close every OPEN conversation for an offer when the offer becomes terminal. Idempotent and
   * keyed on `offer_id` (the conversation carries it), so chat needs no negotiation lookup.
   */
  async closeConversationsForOffer(offerId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE "chat_conversations"
       SET "status" = 'CLOSED', "updated_at" = NOW()
       WHERE "offer_id" = $1 AND "status" = 'OPEN'`,
      [offerId],
    );
  }

  /** Look up an existing message by its client id within the locked transaction. */
  private async findByClientMessageId(
    manager: EntityManager,
    conversationId: string,
    clientMessageId: string,
  ): Promise<ChatMessage | null> {
    return manager
      .getRepository(ChatMessage)
      .findOne({ where: { conversationId, clientMessageId } });
  }
}

/** Raw inbox row shape returned by `listConversationsForUser`. */
export interface ConversationInboxRow {
  readonly id: string;
  readonly thread_id: string;
  readonly offer_id: string;
  readonly host_id: string | null;
  readonly cleaner_id: string | null;
  readonly status: string;
  readonly last_message_at: Date | null;
  readonly created_at: Date;
  readonly last_message_preview: string | null;
}
