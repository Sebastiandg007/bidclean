import { DataSource, EntityManager } from 'typeorm';

import { VoipRepository, VoipCallRow } from '../voip.repository';
import { CallStatus, EndReason, MediaKind } from '../voip.constants';

/**
 * Unit tests for VoipRepository (Task 4.2).
 *
 * Validates: Requirements 2.7, 4.1, 4.2 · P7, P10, P14.
 * - the single-winner terminal write returns the row for the winner (rows=1) and null for a loser
 *   (rows=0), deriving duration once;
 * - `answer` transitions only from RINGING;
 * - the idempotency lookup is scoped to `(conversation, initiator, clientCallId)` + non-terminal;
 * - sweep queries select only aged rows and are parameterized (never string-interpolate inputs).
 *
 * A recording fake DataSource captures each `query(sql, params)` and returns a canned result, so we
 * assert BOTH the emitted SQL shape (WHERE guards, parameter placeholders) and how the repository
 * interprets an empty vs non-empty result — without a live database.
 */

interface RecordedQuery {
  readonly sql: string;
  readonly params: unknown[];
}

/** A recording fake that returns queued results in order and captures every query. */
class RecordingDataSource {
  readonly queries: RecordedQuery[] = [];
  private results: unknown[][] = [];

  queueResult(rows: unknown[]): void {
    this.results.push(rows);
  }

  query = async (sql: string, params: unknown[] = []): Promise<unknown[]> => {
    this.queries.push({ sql, params });
    return this.results.shift() ?? [];
  };

  last(): RecordedQuery {
    const q = this.queries[this.queries.length - 1];
    if (!q) {
      throw new Error('no query recorded');
    }
    return q;
  }
}

function sampleRow(overrides: Partial<VoipCallRow> = {}): VoipCallRow {
  return {
    id: 'call-1',
    conversation_id: 'conv-1',
    offer_id: 'offer-1',
    initiator_id: 'user-a',
    callee_id: 'user-b',
    media_kind: MediaKind.AUDIO,
    room_name: 'call-room-1',
    status: CallStatus.ONGOING,
    end_reason: null,
    client_call_id: 'ccid-1',
    initiated_at: new Date(),
    answered_at: new Date(),
    ended_at: null,
    last_media_activity_at: null,
    duration_seconds: null,
    ...overrides,
  };
}

function build(): { db: RecordingDataSource; repo: VoipRepository } {
  const db = new RecordingDataSource();
  const repo = new VoipRepository(db as unknown as DataSource);
  return { db, repo };
}

describe('VoipRepository — single-winner writes', () => {
  it('transitionTerminal returns the row for the winner (rows=1)', async () => {
    const { db, repo } = build();
    db.queueResult([sampleRow({ status: CallStatus.ENDED, end_reason: EndReason.HANGUP })]);

    const result = await repo.transitionTerminal(
      'call-1',
      CallStatus.ONGOING,
      CallStatus.ENDED,
      EndReason.HANGUP,
    );

    expect(result?.status).toBe(CallStatus.ENDED);
    const q = db.last();
    // The conditional guard: only transitions from the expected non-terminal status.
    expect(q.sql).toMatch(/WHERE "id" = \$1 AND "status" = \$2/);
    expect(q.params).toEqual(['call-1', CallStatus.ONGOING, CallStatus.ENDED, EndReason.HANGUP]);
    // Duration is derived once, in SQL.
    expect(q.sql).toMatch(/"duration_seconds" = CASE/);
  });

  it('transitionTerminal returns null for a loser (rows=0 → idempotent no-op)', async () => {
    const { db, repo } = build();
    db.queueResult([]); // no rows updated: the call was already terminal

    const result = await repo.transitionTerminal(
      'call-1',
      CallStatus.ONGOING,
      CallStatus.ENDED,
      EndReason.HANGUP,
    );
    expect(result).toBeNull();
  });

  it('answer transitions only from RINGING (guarded WHERE)', async () => {
    const { db, repo } = build();
    db.queueResult([sampleRow({ status: CallStatus.ONGOING })]);

    const result = await repo.answer('call-1');
    expect(result?.status).toBe(CallStatus.ONGOING);
    const q = db.last();
    expect(q.sql).toContain(`"status" = '${CallStatus.RINGING}'`);
    expect(q.sql).toMatch(/SET "status" = 'ONGOING', "answered_at" = NOW\(\)/);
    expect(q.params).toEqual(['call-1']);
  });

  it('answer returns null when the call was not RINGING', async () => {
    const { db, repo } = build();
    db.queueResult([]);
    expect(await repo.answer('call-1')).toBeNull();
  });
});

describe('VoipRepository — idempotency & lookups', () => {
  it('findConsumableByClientCallId scopes to (conversation, initiator, clientCallId) + non-terminal', async () => {
    const { db, repo } = build();
    db.queueResult([sampleRow({ status: CallStatus.RINGING })]);

    const managerLike = { query: db.query } as unknown as EntityManager;
    const found = await repo.findConsumableByClientCallId(
      managerLike,
      'conv-1',
      'user-a',
      'ccid-1',
    );
    expect(found?.status).toBe(CallStatus.RINGING);
    const q = db.last();
    expect(q.params).toEqual(['conv-1', 'user-a', 'ccid-1']);
    expect(q.sql).toMatch(/"conversation_id" = \$1 AND "initiator_id" = \$2 AND "client_call_id" = \$3/);
    expect(q.sql).toContain(`'${CallStatus.RINGING}', '${CallStatus.ONGOING}'`);
  });

  it('findActiveForConversation filters to the non-terminal set', async () => {
    const { db, repo } = build();
    db.queueResult([]);
    await repo.findActiveForConversation('conv-1');
    const q = db.last();
    expect(q.params).toEqual(['conv-1']);
    expect(q.sql).toContain(`'${CallStatus.RINGING}', '${CallStatus.ONGOING}'`);
  });
});

describe('VoipRepository — sweep queries', () => {
  it('findRingingOlderThan selects only aged RINGING rows (parameterized)', async () => {
    const { db, repo } = build();
    const cutoff = new Date('2026-01-01T00:00:00Z');
    db.queueResult([{ id: 'r1', conversation_id: 'c1' }]);

    const aged = await repo.findRingingOlderThan(cutoff, 50);
    expect(aged).toEqual([{ id: 'r1', conversationId: 'c1' }]);
    const q = db.last();
    expect(q.sql).toContain(`"status" = '${CallStatus.RINGING}' AND "initiated_at" < $1`);
    expect(q.params).toEqual([cutoff, 50]);
  });

  it('findStaleOngoing selects aged/over-max ONGOING rows (parameterized)', async () => {
    const { db, repo } = build();
    const staleBefore = new Date('2026-01-01T00:00:00Z');
    const maxDurationBefore = new Date('2025-12-31T00:00:00Z');
    db.queueResult([{ id: 'o1', conversation_id: 'c1' }]);

    const stale = await repo.findStaleOngoing(staleBefore, maxDurationBefore, 25);
    expect(stale).toEqual([{ id: 'o1', conversationId: 'c1' }]);
    const q = db.last();
    expect(q.sql).toContain(`"status" = '${CallStatus.ONGOING}'`);
    expect(q.params).toEqual([staleBefore, maxDurationBefore, 25]);
  });

  it('touchMediaActivity never regresses the clock and only touches ONGOING', async () => {
    const { db, repo } = build();
    db.queueResult([]);
    const at = new Date('2026-02-02T00:00:00Z');
    await repo.touchMediaActivity('call-room-1', at);
    const q = db.last();
    expect(q.params).toEqual(['call-room-1', at]);
    expect(q.sql).toContain(`"status" = '${CallStatus.ONGOING}'`);
    expect(q.sql).toMatch(/"last_media_activity_at" IS NULL OR "last_media_activity_at" < \$2/);
  });
});

describe('VoipRepository — history', () => {
  it('listForConversation returns the latest page when before is null', async () => {
    const { db, repo } = build();
    db.queueResult([sampleRow()]);
    await repo.listForConversation('conv-1', null, 20);
    const q = db.last();
    expect(q.params).toEqual(['conv-1', 20]);
    expect(q.sql).not.toContain('< $2');
  });

  it('listForConversation applies the keyset cursor when before is provided', async () => {
    const { db, repo } = build();
    const before = new Date('2026-03-03T00:00:00Z');
    db.queueResult([]);
    await repo.listForConversation('conv-1', before, 20);
    const q = db.last();
    expect(q.params).toEqual(['conv-1', before, 20]);
    expect(q.sql).toContain('"initiated_at" < $2');
  });
});
