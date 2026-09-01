import { ChatConversation } from '../../entities/chat-conversation.entity';
import { ChatMessage } from '../../entities/chat-message.entity';

/**
 * A minimal, behavioral in-memory stand-in for TypeORM's DataSource, modelling ONLY the
 * operations `ChatRepository` performs against `chat_conversations` / `chat_messages`:
 * `getRepository().findOne/create/save`, a query builder for keyset reads, `transaction`, and the
 * handful of raw `query(...)` statements (FOR UPDATE lock, last_message_at bump, participant
 * EXISTS, inbox, close). It lets the repository's invariants — idempotent open, serialized
 * sequence allocation, dedup/conflict, OPEN-check under lock, keyset paging — be tested without
 * a live Postgres.
 */

const UNIQUE_VIOLATION = '23505';

class UniqueViolationError extends Error {
  readonly code = UNIQUE_VIOLATION;
}

type Table = 'ChatConversation' | 'ChatMessage';

function tableFor(entity: unknown): Table {
  return entity === ChatConversation ? 'ChatConversation' : 'ChatMessage';
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export class InMemoryChatDataSource {
  readonly conversations: Array<Record<string, unknown>> = [];
  readonly messages: Array<Record<string, unknown>> = [];

  getRepository(entity: unknown): InMemoryChatRepository {
    return new InMemoryChatRepository(this, tableFor(entity));
  }

  async transaction<T>(
    work: (manager: {
      getRepository: (e: unknown) => InMemoryChatRepository;
      query: (sql: string, params?: unknown[]) => Promise<unknown>;
    }) => Promise<T>,
  ): Promise<T> {
    return work({
      getRepository: (e: unknown) => this.getRepository(e),
      query: (sql: string, params?: unknown[]) => this.query(sql, params),
    });
  }

  rows(table: Table): Array<Record<string, unknown>> {
    return table === 'ChatConversation' ? this.conversations : this.messages;
  }

  /** Handles the small set of raw SQL statements the repository issues. */
  async query(sql: string, params: unknown[] = []): Promise<unknown> {
    if (sql.includes('FROM "chat_conversations" WHERE "id" = $1 FOR UPDATE')) {
      const conv = this.conversations.find((c) => c.id === params[0]);
      return conv ? [{ message_seq: conv.message_seq, status: conv.status }] : [];
    }
    if (sql.includes('EXISTS') && sql.includes('chat_conversations')) {
      const [conversationId, userId] = params;
      const exists = this.conversations.some(
        (c) => c.id === conversationId && (c.host_id === userId || c.cleaner_id === userId),
      );
      return [{ exists }];
    }
    if (sql.includes('UPDATE "chat_conversations"') && sql.includes('"message_seq" = $1')) {
      const [seq, id] = params;
      const conv = this.conversations.find((c) => c.id === id);
      if (conv) {
        conv.message_seq = seq;
        conv.last_message_at = new Date();
      }
      return undefined;
    }
    if (sql.includes('UPDATE "chat_conversations"') && sql.includes(`'CLOSED'`)) {
      const threadId = params[0];
      for (const conv of this.conversations) {
        if (conv.thread_id === threadId && conv.status === 'OPEN') {
          conv.status = 'CLOSED';
        }
      }
      return undefined;
    }
    if (sql.includes('FROM "chat_conversations" c')) {
      return this.inbox(params[0] as string, params[1] as number);
    }
    throw new Error(`Unhandled SQL in InMemoryChatDataSource: ${sql}`);
  }

  private inbox(userId: string, limit: number): Array<Record<string, unknown>> {
    const owned = this.conversations.filter(
      (c) => c.host_id === userId || c.cleaner_id === userId,
    );
    const sorted = [...owned].sort((a, b) => msAt(b.last_message_at) - msAt(a.last_message_at));
    return sorted.slice(0, limit).map((c) => ({
      id: c.id,
      thread_id: c.thread_id,
      offer_id: c.offer_id,
      host_id: c.host_id,
      cleaner_id: c.cleaner_id,
      status: c.status,
      last_message_at: c.last_message_at ?? null,
      created_at: c.created_at,
      last_message_preview: this.latestBody(c.id as string),
    }));
  }

  private latestBody(conversationId: string): string | null {
    const msgs = this.messages
      .filter((m) => m.conversation_id === conversationId)
      .sort((a, b) => (b.sequence_number as number) - (a.sequence_number as number));
    return (msgs[0]?.body as string) ?? null;
  }
}

function msAt(value: unknown): number {
  return value instanceof Date ? value.getTime() : 0;
}

/** Maps camelCase entity fields to the snake_case row columns the harness stores. */
const COLUMN_MAP: Record<string, string> = {
  conversationId: 'conversation_id',
  senderId: 'sender_id',
  clientMessageId: 'client_message_id',
  sequenceNumber: 'sequence_number',
  threadId: 'thread_id',
  offerId: 'offer_id',
  hostId: 'host_id',
  cleanerId: 'cleaner_id',
  messageSeq: 'message_seq',
  lastMessageAt: 'last_message_at',
};

function toColumn(field: string): string {
  return COLUMN_MAP[field] ?? field;
}

export class InMemoryChatRepository {
  constructor(private readonly db: InMemoryChatDataSource, private readonly table: Table) {}

  create(values: Record<string, unknown>): Record<string, unknown> {
    return { ...values };
  }

  async findOne(options: {
    where: Record<string, unknown>;
  }): Promise<Record<string, unknown> | null> {
    const found = this.db
      .rows(this.table)
      .find((row) => this.matchesEntity(row, options.where));
    return found ? this.toEntity(found) : null;
  }

  async save(values: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.enforceUnique(values);
    const id = (values.id as string) ?? nextId(this.table === 'ChatConversation' ? 'conv' : 'msg');
    const row = this.toRow({ ...values, id });
    if (!row.created_at) {
      row.created_at = new Date();
    }
    this.db.rows(this.table).push(row);
    return this.toEntity(row);
  }

  createQueryBuilder(_alias: string): InMemoryChatQueryBuilder {
    return new InMemoryChatQueryBuilder(this.db.rows(this.table), (r) => this.toEntity(r));
  }

  private matchesEntity(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([field, value]) => row[toColumn(field)] === value);
  }

  private toRow(values: Record<string, unknown>): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(values)) {
      row[toColumn(field)] = value;
    }
    return row;
  }

  private toEntity(row: Record<string, unknown>): Record<string, unknown> {
    const entity: Record<string, unknown> = {};
    for (const [field, column] of Object.entries(COLUMN_MAP)) {
      if (column in row) {
        entity[field] = row[column];
      }
    }
    for (const [key, value] of Object.entries(row)) {
      if (!Object.values(COLUMN_MAP).includes(key)) {
        entity[key] = value;
      }
    }
    return entity;
  }

  private enforceUnique(values: Record<string, unknown>): void {
    if (this.table === 'ChatConversation' && values.threadId !== undefined) {
      if (this.db.conversations.some((c) => c.thread_id === values.threadId)) {
        throw new UniqueViolationError('duplicate thread_id');
      }
    }
    if (this.table === 'ChatMessage') {
      const clash = this.db.messages.some(
        (m) =>
          m.conversation_id === values.conversationId &&
          (m.sequence_number === values.sequenceNumber ||
            m.client_message_id === values.clientMessageId),
      );
      if (clash) {
        throw new UniqueViolationError('duplicate message sequence/client id');
      }
    }
  }
}

/** Models the keyset query builder used for before/after history reads. */
export class InMemoryChatQueryBuilder {
  private conversationId: string | null = null;
  private lessThan: number | null = null;
  private greaterThan: number | null = null;
  private direction: 'ASC' | 'DESC' = 'DESC';
  private limit = Infinity;

  constructor(
    private readonly rows: Array<Record<string, unknown>>,
    private readonly toEntity: (row: Record<string, unknown>) => Record<string, unknown>,
  ) {}

  where(_clause: string, params: { conversationId: string }): this {
    this.conversationId = params.conversationId;
    return this;
  }

  andWhere(clause: string, params: { beforeSeq?: number; afterSeq?: number }): this {
    if (params.beforeSeq !== undefined) {
      this.lessThan = params.beforeSeq;
    }
    if (params.afterSeq !== undefined) {
      this.greaterThan = params.afterSeq;
    }
    return this;
  }

  orderBy(_field: string, direction: 'ASC' | 'DESC'): this {
    this.direction = direction;
    return this;
  }

  take(limit: number): this {
    this.limit = limit;
    return this;
  }

  async getMany(): Promise<Array<Record<string, unknown>>> {
    let result = this.rows.filter((r) => r.conversation_id === this.conversationId);
    if (this.lessThan !== null) {
      result = result.filter((r) => (r.sequence_number as number) < (this.lessThan as number));
    }
    if (this.greaterThan !== null) {
      result = result.filter((r) => (r.sequence_number as number) > (this.greaterThan as number));
    }
    result = [...result].sort((a, b) => {
      const cmp = (a.sequence_number as number) - (b.sequence_number as number);
      return this.direction === 'DESC' ? -cmp : cmp;
    });
    return result.slice(0, this.limit).map((r) => this.toEntity(r));
  }
}
