import { DataSource, EntityManager } from 'typeorm';

import { ServiceSessionRepository } from '../service-session.repository';
import { SERVICE_OUTBOX_TABLE, buildArrivedOutboxRow } from '../service-outbox';
import { SessionState } from '../service-tracking.types';

/**
 * Unit tests for ServiceSessionRepository (Spec 17).
 *
 * The DataSource is mocked to capture the parameterized SQL + params. These assert the SHAPE of the
 * queries (single-winner `WHERE state=:expected`, the outbox written in the same transaction, the
 * per-consumer `NOT EXISTS` scan, idempotent `ON CONFLICT`); the actual PostGIS/SQL execution is
 * exercised by the integration tests.
 */

interface QueryCall {
  sql: string;
  params: readonly unknown[] | undefined;
}

function buildRepo(): {
  repo: ServiceSessionRepository;
  calls: QueryCall[];
  txCalls: QueryCall[];
  setNextRows: (rows: unknown[]) => void;
} {
  const calls: QueryCall[] = [];
  const txCalls: QueryCall[] = [];
  let nextRows: unknown[] = [];

  const manager = {
    query: jest.fn(async (sql: string, params?: readonly unknown[]) => {
      txCalls.push({ sql, params });
      return nextRows;
    }),
  } as unknown as EntityManager;

  const dataSource = {
    query: jest.fn(async (sql: string, params?: readonly unknown[]) => {
      calls.push({ sql, params });
      return nextRows;
    }),
    transaction: jest.fn(async (cb: (m: EntityManager) => Promise<unknown>) => cb(manager)),
  } as unknown as DataSource;

  return {
    repo: new ServiceSessionRepository(dataSource),
    calls,
    txCalls,
    setNextRows: (rows) => {
      nextRows = rows;
    },
  };
}

describe('ServiceSessionRepository.createSession', () => {
  it('uses ON CONFLICT (offer_id) DO NOTHING and snapshots the property location', async () => {
    const { repo, calls, setNextRows } = buildRepo();
    setNextRows([{ id: 's1' }]);
    await repo.createSession(
      { offerId: 'o1', hostId: 'h1', cleanerId: 'c1', propertyId: 'p1' },
      50,
    );
    const insert = calls[0];
    expect(insert?.sql).toContain('ON CONFLICT ("offer_id") DO NOTHING');
    expect(insert?.sql).toContain('p."location"');
    expect(insert?.params).toEqual(['o1', 'h1', 'c1', 'p1', 50]);
  });
});

describe('ServiceSessionRepository.transition (single-winner + outbox in one tx)', () => {
  it('guards on WHERE state=:expected and writes the outbox row in the SAME transaction', async () => {
    const { repo, txCalls, setNextRows } = buildRepo();
    setNextRows([{ id: 's1', offer_id: 'o1', state: SessionState.ARRIVED }]);
    const outbox = buildArrivedOutboxRow(
      { sessionId: 's1', offerId: 'o1', cleanerId: 'c1', hostId: 'h1' },
      12,
    );
    await repo.transition(
      's1',
      SessionState.EN_ROUTE,
      SessionState.ARRIVED,
      { arrivedAt: true, arrivalDistanceM: 12 },
      outbox,
    );
    const update = txCalls[0];
    expect(update?.sql).toContain('WHERE "id" = $1 AND "state" = $2');
    const insert = txCalls[1];
    expect(insert?.sql).toContain(`INSERT INTO "${SERVICE_OUTBOX_TABLE}"`);
    expect(insert?.params?.[0]).toBe('service_arrived:s1');
  });

  it('returns null (no-op) and writes no outbox when the guard does not match (rows=0)', async () => {
    const { repo, txCalls, setNextRows } = buildRepo();
    setNextRows([]); // UPDATE matched no rows → loser
    const outbox = buildArrivedOutboxRow(
      { sessionId: 's1', offerId: 'o1', cleanerId: 'c1', hostId: 'h1' },
      12,
    );
    const result = await repo.transition(
      's1',
      SessionState.EN_ROUTE,
      SessionState.ARRIVED,
      { arrivedAt: true },
      outbox,
    );
    expect(result).toBeNull();
    // Only the UPDATE ran; the outbox INSERT was skipped.
    expect(txCalls).toHaveLength(1);
  });
});

describe('ServiceSessionRepository — per-consumer outbox queries', () => {
  it('findOutboxUnackedFor uses a NOT EXISTS scan keyed by consumer_name', async () => {
    const { repo, calls, setNextRows } = buildRepo();
    setNextRows([]);
    await repo.findOutboxUnackedFor('video', 100);
    const sql = calls[0]?.sql ?? '';
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('c."consumer_name" = $1');
    expect(calls[0]?.params).toEqual(['video', 100]);
  });

  it('ackOutboxFor is idempotent (ON CONFLICT DO NOTHING) per (event_id, consumer_name)', async () => {
    const { repo, calls } = buildRepo();
    await repo.ackOutboxFor('service_arrived:s1', 'notifications');
    expect(calls[0]?.sql).toContain('ON CONFLICT ("event_id", "consumer_name") DO NOTHING');
    expect(calls[0]?.params).toEqual(['service_arrived:s1', 'notifications']);
  });
});

describe('ServiceSessionRepository — activation cursor', () => {
  it('findActivationUnconsumed uses a NOT EXISTS scan against service_activation_consumed', async () => {
    const { repo, calls, setNextRows } = buildRepo();
    setNextRows([]);
    await repo.findActivationUnconsumed(100);
    const sql = calls[0]?.sql ?? '';
    expect(sql).toContain('"service_activation_outbox"');
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('"service_activation_consumed"');
  });

  it('markActivationConsumed is idempotent on upstream_event_id', async () => {
    const { repo, calls } = buildRepo();
    await repo.markActivationConsumed('service_activation_ready:o1');
    expect(calls[0]?.sql).toContain('ON CONFLICT ("upstream_event_id") DO NOTHING');
  });
});

describe('ServiceSessionRepository — sweep queries select only aged non-terminal rows', () => {
  it('findAbandonedMatched filters MATCHED older than the cutoff', async () => {
    const { repo, calls, setNextRows } = buildRepo();
    setNextRows([]);
    const cutoff = new Date(1000);
    await repo.findAbandonedMatched(cutoff, 100);
    const sql = calls[0]?.sql ?? '';
    expect(sql).toContain(`"state" = '${SessionState.MATCHED}'`);
    expect(sql).toContain('"created_at" < $1');
  });

  it('findExpirableEnRoute filters EN_ROUTE by last_progress_at fallback', async () => {
    const { repo, calls, setNextRows } = buildRepo();
    setNextRows([]);
    await repo.findExpirableEnRoute(new Date(1000), 100);
    const sql = calls[0]?.sql ?? '';
    expect(sql).toContain(`"state" = '${SessionState.EN_ROUTE}'`);
    expect(sql).toContain('COALESCE("last_progress_at", "en_route_at", "created_at")');
  });
});
