import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { VoipCall } from './entities/voip-call.entity';
import { CallStatus, EndReason, MediaKind } from './voip.constants';

/** Raw `voip_calls` row shape (snake_case) returned by parameterized queries. */
export interface VoipCallRow {
  readonly id: string;
  readonly conversation_id: string;
  readonly offer_id: string;
  readonly initiator_id: string | null;
  readonly callee_id: string | null;
  readonly media_kind: string;
  readonly room_name: string;
  readonly status: string;
  readonly end_reason: string | null;
  readonly client_call_id: string;
  readonly initiated_at: Date;
  readonly answered_at: Date | null;
  readonly ended_at: Date | null;
  readonly last_media_activity_at: Date | null;
  readonly duration_seconds: number | null;
}

/** Parameters to insert the RINGING row inside the serialized initiate transaction. */
export interface InsertRingingParams {
  readonly conversationId: string;
  readonly offerId: string;
  readonly initiatorId: string;
  readonly calleeId: string;
  readonly mediaKind: MediaKind;
  readonly roomName: string;
  readonly clientCallId: string;
}

/** A RINGING call the ring-timeout sweep must force to MISSED. */
export interface AgedRingingCall {
  readonly id: string;
  readonly conversationId: string;
}

/** An ONGOING call the stale-call sweep must force to ENDED/TIMEOUT. */
export interface StaleOngoingCall {
  readonly id: string;
  readonly conversationId: string;
}

/** The full SELECT list, kept once so every read returns the same shape. */
const SELECT_COLUMNS = `
  "id", "conversation_id", "offer_id", "initiator_id", "callee_id", "media_kind",
  "room_name", "status", "end_reason", "client_call_id", "initiated_at", "answered_at",
  "ended_at", "last_media_activity_at", "duration_seconds"
`;

/**
 * VoipRepository (`voip_calls`) — parameterized SQL only.
 *
 * Owns every read/write of the call record. The authoritative lifecycle guarantee is the
 * SINGLE-WINNER conditional write: a terminal transition (or the answer transition) is
 * `UPDATE ... WHERE id=:id AND status=:expectedNonTerminal RETURNING ...`, so under N concurrent
 * actors exactly one observes `rowCount = 1` (the winner, which sets the derived fields) and every
 * other observes `rowCount = 0` and no-ops. `duration_seconds` is derived once, in SQL, by the
 * winning UPDATE. `insertRinging` runs inside the caller's serialized transaction (shared
 * EntityManager) so the "one active call per conversation" partial unique index is enforced atomically.
 * No media, room name, or participant PII is ever logged.
 */
@Injectable()
export class VoipRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Insert the RINGING row inside the serialized initiate transaction (shared manager). A
   * concurrent second active call violates `uq_voip_one_active_per_conversation` and throws — the
   * service maps that to `409 busy`. Returns the persisted row.
   */
  async insertRinging(
    manager: EntityManager,
    params: InsertRingingParams,
  ): Promise<VoipCallRow> {
    const rows = await manager.query<VoipCallRow[]>(
      `INSERT INTO "voip_calls"
         ("conversation_id", "offer_id", "initiator_id", "callee_id", "media_kind",
          "room_name", "status", "client_call_id", "initiated_at")
       VALUES ($1, $2, $3, $4, $5, $6, '${CallStatus.RINGING}', $7, NOW())
       RETURNING ${SELECT_COLUMNS}`,
      [
        params.conversationId,
        params.offerId,
        params.initiatorId,
        params.calleeId,
        params.mediaKind,
        params.roomName,
        params.clientCallId,
      ],
    );
    // A RETURNING insert always yields exactly one row; a missing row is a genuine invariant break.
    const row = rows[0];
    if (!row) {
      throw new Error('voip_calls insert returned no row');
    }
    return row;
  }

  /**
   * The idempotency lookup: an existing NON-TERMINAL call for the same
   * `(conversation_id, initiator_id, client_call_id)` — the exact scope of `uq_voip_client_call`.
   * Runs inside the serialized transaction so a retry observes the row a concurrent initiate wrote.
   */
  async findConsumableByClientCallId(
    manager: EntityManager,
    conversationId: string,
    initiatorId: string,
    clientCallId: string,
  ): Promise<VoipCallRow | null> {
    const rows = await manager.query<VoipCallRow[]>(
      `SELECT ${SELECT_COLUMNS}
       FROM "voip_calls"
       WHERE "conversation_id" = $1 AND "initiator_id" = $2 AND "client_call_id" = $3
         AND "status" IN ('${CallStatus.RINGING}', '${CallStatus.ONGOING}')
       LIMIT 1`,
      [conversationId, initiatorId, clientCallId],
    );
    return rows[0] ?? null;
  }

  /** The current non-terminal call for a conversation, if any (busy check / reconciliation). */
  async findActiveForConversation(conversationId: string): Promise<VoipCallRow | null> {
    const rows = await this.dataSource.query<VoipCallRow[]>(
      `SELECT ${SELECT_COLUMNS}
       FROM "voip_calls"
       WHERE "conversation_id" = $1
         AND "status" IN ('${CallStatus.RINGING}', '${CallStatus.ONGOING}')
       LIMIT 1`,
      [conversationId],
    );
    return rows[0] ?? null;
  }

  /** Load a call by id (reconciliation / role checks). */
  async findById(id: string): Promise<VoipCallRow | null> {
    const rows = await this.dataSource.query<VoipCallRow[]>(
      `SELECT ${SELECT_COLUMNS} FROM "voip_calls" WHERE "id" = $1 LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  }

  /** Load a call by its opaque room name (webhook resolution). */
  async findByRoomName(roomName: string): Promise<VoipCallRow | null> {
    const rows = await this.dataSource.query<VoipCallRow[]>(
      `SELECT ${SELECT_COLUMNS} FROM "voip_calls" WHERE "room_name" = $1 LIMIT 1`,
      [roomName],
    );
    return rows[0] ?? null;
  }

  /**
   * Single-winner answer: `RINGING -> ONGOING` with `answered_at = NOW()`. Returns the updated row
   * for the winner, or null when the call was not RINGING (already answered/terminal → 409).
   */
  async answer(id: string): Promise<VoipCallRow | null> {
    const rows = await this.dataSource.query<VoipCallRow[]>(
      `UPDATE "voip_calls"
       SET "status" = '${CallStatus.ONGOING}', "answered_at" = NOW(), "updated_at" = NOW()
       WHERE "id" = $1 AND "status" = '${CallStatus.RINGING}'
       RETURNING ${SELECT_COLUMNS}`,
      [id],
    );
    return rows[0] ?? null;
  }

  /**
   * Single-winner terminal transition. Derives `duration_seconds` once in SQL (0 when never
   * answered). Returns the updated row for the winner, or null when the call was not in the
   * expected non-terminal status (already terminal → idempotent no-op).
   */
  async transitionTerminal(
    id: string,
    expectedStatus: CallStatus,
    terminalStatus: CallStatus,
    endReason: EndReason,
    manager?: EntityManager,
  ): Promise<VoipCallRow | null> {
    const runner = manager ?? this.dataSource;
    const rows = await runner.query<VoipCallRow[]>(
      `UPDATE "voip_calls"
       SET "status" = $3,
           "ended_at" = NOW(),
           "end_reason" = $4,
           "duration_seconds" = CASE
             WHEN "answered_at" IS NULL THEN 0
             ELSE GREATEST(0, EXTRACT(EPOCH FROM (NOW() - "answered_at"))::int)
           END,
           "updated_at" = NOW()
       WHERE "id" = $1 AND "status" = $2
       RETURNING ${SELECT_COLUMNS}`,
      [id, expectedStatus, terminalStatus, endReason],
    );
    return rows[0] ?? null;
  }

  /**
   * Force every non-terminal call of a conversation to a terminal status (offer-terminal /
   * conversation-close path). Single-winner per row via the `status IN (non-terminal)` guard;
   * idempotent (a conversation with no active call updates nothing). Returns the ended rows.
   */
  async forceEndForConversation(
    conversationId: string,
    terminalStatus: CallStatus,
    endReason: EndReason,
  ): Promise<VoipCallRow[]> {
    return this.dataSource.query<VoipCallRow[]>(
      `UPDATE "voip_calls"
       SET "status" = $2,
           "ended_at" = NOW(),
           "end_reason" = $3,
           "duration_seconds" = CASE
             WHEN "answered_at" IS NULL THEN 0
             ELSE GREATEST(0, EXTRACT(EPOCH FROM (NOW() - "answered_at"))::int)
           END,
           "updated_at" = NOW()
       WHERE "conversation_id" = $1
         AND "status" IN ('${CallStatus.RINGING}', '${CallStatus.ONGOING}')
       RETURNING ${SELECT_COLUMNS}`,
      [conversationId, terminalStatus, endReason],
    );
  }

  /**
   * Update `last_media_activity_at` for a room (LiveKit webhook liveness). Never advances the clock
   * backwards, and never touches a terminal call. Idempotent by construction.
   */
  async touchMediaActivity(roomName: string, at: Date): Promise<void> {
    await this.dataSource.query(
      `UPDATE "voip_calls"
       SET "last_media_activity_at" = $2, "updated_at" = NOW()
       WHERE "room_name" = $1
         AND "status" = '${CallStatus.ONGOING}'
         AND ("last_media_activity_at" IS NULL OR "last_media_activity_at" < $2)`,
      [roomName, at],
    );
  }

  /** RINGING calls initiated before `olderThan` (ring-timeout sweep input). Oldest-first, bounded. */
  async findRingingOlderThan(olderThan: Date, limit: number): Promise<AgedRingingCall[]> {
    const rows = await this.dataSource.query<
      Array<{ id: string; conversation_id: string }>
    >(
      `SELECT "id", "conversation_id"
       FROM "voip_calls"
       WHERE "status" = '${CallStatus.RINGING}' AND "initiated_at" < $1
       ORDER BY "initiated_at" ASC
       LIMIT $2`,
      [olderThan, limit],
    );
    return rows.map((row) => ({ id: row.id, conversationId: row.conversation_id }));
  }

  /**
   * ONGOING calls whose media activity is stale OR whose answer is older than the max duration
   * (stale-call sweep input). Oldest-activity-first, bounded.
   */
  async findStaleOngoing(
    staleBefore: Date,
    maxDurationBefore: Date,
    limit: number,
  ): Promise<StaleOngoingCall[]> {
    const rows = await this.dataSource.query<
      Array<{ id: string; conversation_id: string }>
    >(
      `SELECT "id", "conversation_id"
       FROM "voip_calls"
       WHERE "status" = '${CallStatus.ONGOING}'
         AND (
           COALESCE("last_media_activity_at", "answered_at", "initiated_at") < $1
           OR ("answered_at" IS NOT NULL AND "answered_at" < $2)
         )
       ORDER BY COALESCE("last_media_activity_at", "answered_at", "initiated_at") ASC
       LIMIT $3`,
      [staleBefore, maxDurationBefore, limit],
    );
    return rows.map((row) => ({ id: row.id, conversationId: row.conversation_id }));
  }

  /**
   * Call history for a conversation, most-recent first, keyset-paginated by `initiated_at`.
   * `before` is an ISO timestamp cursor (exclusive); null returns the latest page.
   */
  async listForConversation(
    conversationId: string,
    before: Date | null,
    limit: number,
  ): Promise<VoipCallRow[]> {
    if (before === null) {
      return this.dataSource.query<VoipCallRow[]>(
        `SELECT ${SELECT_COLUMNS}
         FROM "voip_calls"
         WHERE "conversation_id" = $1
         ORDER BY "initiated_at" DESC
         LIMIT $2`,
        [conversationId, limit],
      );
    }
    return this.dataSource.query<VoipCallRow[]>(
      `SELECT ${SELECT_COLUMNS}
       FROM "voip_calls"
       WHERE "conversation_id" = $1 AND "initiated_at" < $2
       ORDER BY "initiated_at" DESC
       LIMIT $3`,
      [conversationId, before, limit],
    );
  }

  /** Map a raw row to the typed entity shape (used where callers prefer the entity type). */
  static toEntity(row: VoipCallRow): VoipCall {
    const call = new VoipCall();
    call.id = row.id;
    call.conversationId = row.conversation_id;
    call.offerId = row.offer_id;
    call.initiatorId = row.initiator_id;
    call.calleeId = row.callee_id;
    call.mediaKind = row.media_kind;
    call.roomName = row.room_name;
    call.status = row.status;
    call.endReason = row.end_reason;
    call.clientCallId = row.client_call_id;
    call.initiatedAt = row.initiated_at;
    call.answeredAt = row.answered_at;
    call.endedAt = row.ended_at;
    call.lastMediaActivityAt = row.last_media_activity_at;
    call.durationSeconds = row.duration_seconds;
    return call;
  }
}
