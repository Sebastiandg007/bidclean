import { ChatConversation } from '../../../entities/chat-conversation.entity';
import { ChatMessage } from '../../../entities/chat-message.entity';
import { ChatVoiceNote } from '../../entities/chat-voice-note.entity';

/**
 * Behavioral in-memory DataSource that models the chat + voice-note tables the voice send path
 * touches: `chat_conversations`, `chat_messages`, `chat_voice_notes`, `voice_note_upload_grants`,
 * and `voice_note_object_deletions`. It interprets the exact raw SQL the chat/voice repositories
 * issue (conversation FOR UPDATE, grant FOR UPDATE, grant insert/update, transcript claim/attach
 * guard, tombstones, keyset reads) so the send transaction, grant single-use, fingerprint
 * idempotency, authoritative-bounds, and stale-safe transcript invariants can be exercised without
 * a live Postgres. A BEFORE DELETE tombstone on `chat_voice_notes` is simulated on delete.
 */

const UNIQUE_VIOLATION = '23505';

class UniqueViolationError extends Error {
  readonly code = UNIQUE_VIOLATION;
}

type Table = 'ChatConversation' | 'ChatMessage' | 'ChatVoiceNote';

function tableFor(entity: unknown): Table {
  if (entity === ChatConversation) {
    return 'ChatConversation';
  }
  if (entity === ChatVoiceNote) {
    return 'ChatVoiceNote';
  }
  return 'ChatMessage';
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export class InMemoryVoiceDataSource {
  readonly conversations: Array<Record<string, unknown>> = [];
  readonly messages: Array<Record<string, unknown>> = [];
  readonly voiceNotes: Array<Record<string, unknown>> = [];
  readonly grants: Array<Record<string, unknown>> = [];
  readonly tombstones: Array<Record<string, unknown>> = [];
  /** Captured `chat_outbox` rows written in the send transaction (push Task 12). */
  readonly outbox: Array<Record<string, unknown>> = [];

  getRepository(entity: unknown): InMemoryVoiceRepository {
    return new InMemoryVoiceRepository(this, tableFor(entity));
  }

  async transaction<T>(
    work: (manager: {
      getRepository: (e: unknown) => InMemoryVoiceRepository;
      query: (sql: string, params?: unknown[]) => Promise<unknown>;
    }) => Promise<T>,
  ): Promise<T> {
    return work({
      getRepository: (e: unknown) => this.getRepository(e),
      query: (sql: string, params?: unknown[]) => this.query(sql, params),
    });
  }

  rows(table: Table): Array<Record<string, unknown>> {
    if (table === 'ChatConversation') {
      return this.conversations;
    }
    if (table === 'ChatVoiceNote') {
      return this.voiceNotes;
    }
    return this.messages;
  }

  async query(sql: string, params: unknown[] = []): Promise<unknown> {
    // Conversation row lock.
    if (sql.includes('FROM "chat_conversations" WHERE "id" = $1 FOR UPDATE')) {
      const conv = this.conversations.find((c) => c.id === params[0]);
      return conv ? [{ message_seq: conv.message_seq, status: conv.status }] : [];
    }
    // Participant EXISTS.
    if (sql.includes('EXISTS') && sql.includes('chat_conversations')) {
      const [conversationId, userId] = params;
      const exists = this.conversations.some(
        (c) => c.id === conversationId && (c.host_id === userId || c.cleaner_id === userId),
      );
      return [{ exists }];
    }
    // last_message_at bump.
    if (sql.includes('UPDATE "chat_conversations"') && sql.includes('"message_seq" = $1')) {
      const [seq, id] = params;
      const conv = this.conversations.find((c) => c.id === id);
      if (conv) {
        conv.message_seq = seq;
        conv.last_message_at = new Date();
      }
      return undefined;
    }
    // Close by offer/thread.
    if (sql.includes('UPDATE "chat_conversations"') && sql.includes(`'CLOSED'`)) {
      const matchColumn = sql.includes('"offer_id" = $1') ? 'offer_id' : 'thread_id';
      const target = params[0];
      for (const conv of this.conversations) {
        if (conv[matchColumn] === target && conv.status === 'OPEN') {
          conv.status = 'CLOSED';
        }
      }
      return undefined;
    }
    // ── Grants ──────────────────────────────────────────────────────────────
    if (sql.includes('INSERT INTO "voice_note_upload_grants"')) {
      const [objectKey, conversationId, userId, status, expiresAt] = params;
      this.grants.push({
        object_key: objectKey,
        conversation_id: conversationId,
        issued_to_user_id: userId,
        status,
        expires_at: expiresAt,
        consumed_message_id: null,
        created_at: new Date(),
      });
      return undefined;
    }
    if (sql.includes('FROM "voice_note_upload_grants"') && sql.includes('FOR UPDATE')) {
      const grant = this.grants.find((g) => g.object_key === params[0]);
      return grant
        ? [
            {
              object_key: grant.object_key,
              conversation_id: grant.conversation_id,
              issued_to_user_id: grant.issued_to_user_id,
              status: grant.status,
              expires_at: grant.expires_at,
            },
          ]
        : [];
    }
    if (sql.includes('UPDATE "voice_note_upload_grants"') && sql.includes('"consumed_message_id"')) {
      const [status, messageId, objectKey] = params;
      const grant = this.grants.find((g) => g.object_key === objectKey);
      if (grant) {
        grant.status = status;
        grant.consumed_message_id = messageId;
      }
      return undefined;
    }
    if (sql.includes('SELECT "object_key"') && sql.includes('"expires_at" < $2')) {
      const [status, now, limit] = params as [string, Date, number];
      return this.grants
        .filter((g) => g.status === status && (g.expires_at as Date) < now)
        .slice(0, limit)
        .map((g) => ({ object_key: g.object_key }));
    }
    if (sql.includes('DELETE FROM "voice_note_upload_grants"')) {
      const idx = this.grants.findIndex((g) => g.object_key === params[0]);
      if (idx >= 0) {
        this.grants.splice(idx, 1);
      }
      return undefined;
    }
    if (sql.includes('FROM "voice_note_upload_grants"') && sql.includes('EXISTS')) {
      return [{ exists: this.grants.some((g) => g.object_key === params[0]) }];
    }
    // ── Voice notes ─────────────────────────────────────────────────────────
    if (sql.includes('UPDATE "chat_voice_notes"') && sql.includes('+ 1')) {
      const note = this.voiceNotes.find((v) => v.message_id === params[0]);
      if (!note) {
        return [];
      }
      note.transcript_attempt = (note.transcript_attempt as number) + 1;
      note.updated_at = new Date();
      return [{ transcript_attempt: note.transcript_attempt }];
    }
    if (sql.includes('UPDATE "chat_voice_notes"') && sql.includes('"transcript_attempt" <= $5')) {
      const [transcript, lang, status, messageId, attempt] = params as [
        string | null,
        string | null,
        string,
        string,
        number,
      ];
      const note = this.voiceNotes.find((v) => v.message_id === messageId);
      if (note && (note.transcript_attempt as number) <= attempt) {
        note.transcript = transcript;
        note.transcript_lang = lang;
        note.transcript_status = status;
        note.updated_at = new Date();
        return [{ message_id: messageId }];
      }
      return [];
    }
    if (sql.includes('FROM "chat_voice_notes" v') && sql.includes('JOIN "chat_messages"')) {
      const note = this.voiceNotes.find((v) => v.message_id === params[0]);
      if (!note) {
        return [];
      }
      const msg = this.messages.find((m) => m.id === note.message_id);
      return [
        {
          object_key: note.object_key,
          conversation_id: msg?.conversation_id ?? null,
          transcript_attempt: note.transcript_attempt,
        },
      ];
    }
    if (sql.includes('FROM "chat_voice_notes"') && sql.includes(`'PENDING'`) && sql.includes('"updated_at" < $1')) {
      const [olderThan, limit] = params as [Date, number];
      return this.voiceNotes
        .filter((v) => v.transcript_status === 'PENDING' && (v.updated_at as Date) < olderThan)
        .slice(0, limit)
        .map((v) => ({
          message_id: v.message_id,
          object_key: v.object_key,
          transcript_attempt: v.transcript_attempt,
        }));
    }
    if (sql.includes('FROM "chat_voice_notes"') && sql.includes('EXISTS')) {
      return [{ exists: this.voiceNotes.some((v) => v.object_key === params[0]) }];
    }
    if (sql.includes('UPDATE "chat_voice_notes"') && sql.includes(`'FAILED'`)) {
      const note = this.voiceNotes.find(
        (v) => v.message_id === params[0] && v.transcript_status === 'PENDING',
      );
      if (note) {
        note.transcript_status = 'FAILED';
        note.updated_at = new Date();
      }
      return undefined;
    }
    // ── Tombstones ──────────────────────────────────────────────────────────
    if (sql.includes('FROM "voice_note_object_deletions"') && sql.includes(`= $1`) && sql.includes('EXISTS')) {
      return [
        {
          exists: this.tombstones.some(
            (t) => t.object_key === params[0] && t.status === 'PENDING',
          ),
        },
      ];
    }
    if (sql.includes('SELECT "id", "object_key"') && sql.includes('voice_note_object_deletions')) {
      const [status, limit] = params as [string, number];
      return this.tombstones
        .filter((t) => t.status === status)
        .slice(0, limit)
        .map((t) => ({ id: t.id, object_key: t.object_key }));
    }
    if (sql.includes('UPDATE "voice_note_object_deletions"')) {
      const tombstone = this.tombstones.find((t) => t.id === params[1]);
      if (tombstone) {
        tombstone.status = params[0];
        tombstone.deleted_at = new Date();
      }
      return undefined;
    }
    if (sql.includes('FROM "chat_conversations" c')) {
      return this.inbox(params[0] as string, params[1] as number);
    }
    if (sql.includes('INSERT INTO "chat_outbox"')) {
      // Push Task 12: the send transaction writes a `message-created` outbox row. The behavioral
      // fake just accepts it (a no-op record) so the send path stays exercised end-to-end.
      this.outbox.push({
        event_id: params[0],
        aggregate_type: params[1],
        aggregate_id: params[2],
        type: params[3],
        payload: params[4],
        version: params[5],
      });
      return undefined;
    }
    throw new Error(`Unhandled SQL in InMemoryVoiceDataSource: ${sql}`);
  }

  /** Simulate the BEFORE DELETE tombstone trigger: capture the freed object_key. */
  tombstoneDelete(messageId: string): void {
    const idx = this.voiceNotes.findIndex((v) => v.message_id === messageId);
    if (idx >= 0) {
      const note = this.voiceNotes[idx];
      if (note) {
        this.tombstones.push({
          id: nextId('tomb'),
          object_key: note.object_key,
          status: 'PENDING',
          created_at: new Date(),
          deleted_at: null,
        });
      }
      this.voiceNotes.splice(idx, 1);
    }
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
      last_message_preview: this.latestPreview(c.id as string),
    }));
  }

  private latestPreview(conversationId: string): string | null {
    const msgs = this.messages
      .filter((m) => m.conversation_id === conversationId)
      .sort((a, b) => (b.sequence_number as number) - (a.sequence_number as number));
    return (msgs[0]?.body as string) ?? null;
  }
}

function msAt(value: unknown): number {
  return value instanceof Date ? value.getTime() : 0;
}

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
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  messageId: 'message_id',
  objectKey: 'object_key',
  durationMs: 'duration_ms',
  sizeBytes: 'size_bytes',
  mimeType: 'mime_type',
  transcriptStatus: 'transcript_status',
  transcriptLang: 'transcript_lang',
  transcriptAttempt: 'transcript_attempt',
};

function toColumn(field: string): string {
  return COLUMN_MAP[field] ?? field;
}

export class InMemoryVoiceRepository {
  constructor(private readonly db: InMemoryVoiceDataSource, private readonly table: Table) {}

  create(values: Record<string, unknown>): Record<string, unknown> {
    return { ...values };
  }

  async findOne(options: {
    where: Record<string, unknown>;
  }): Promise<Record<string, unknown> | null> {
    const found = this.db.rows(this.table).find((row) => this.matches(row, options.where));
    return found ? this.toEntity(found) : null;
  }

  async save(values: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.enforceUnique(values);
    const id = (values.id as string) ?? nextId(this.prefix());
    const row = this.toRow({ ...values, id });
    if (!row.created_at) {
      row.created_at = new Date();
    }
    if (this.table === 'ChatVoiceNote' && !row.updated_at) {
      row.updated_at = new Date();
    }
    this.db.rows(this.table).push(row);
    return this.toEntity(row);
  }

  createQueryBuilder(_alias: string): InMemoryVoiceQueryBuilder {
    return new InMemoryVoiceQueryBuilder(this.db.rows(this.table), (r) => this.toEntity(r));
  }

  private prefix(): string {
    if (this.table === 'ChatConversation') {
      return 'conv';
    }
    if (this.table === 'ChatVoiceNote') {
      return 'vn';
    }
    return 'msg';
  }

  private matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
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
    if (this.table === 'ChatVoiceNote') {
      const clash = this.db.voiceNotes.some(
        (v) => v.message_id === values.messageId || v.object_key === values.objectKey,
      );
      if (clash) {
        throw new UniqueViolationError('duplicate voice-note message/object');
      }
    }
  }
}

export class InMemoryVoiceQueryBuilder {
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

  andWhere(_clause: string, params: { beforeSeq?: number; afterSeq?: number }): this {
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

// Ensure ChatMessage import is retained for entity identity mapping.
void ChatMessage;