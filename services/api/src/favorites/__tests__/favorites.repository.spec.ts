import { DataSource, EntityManager } from 'typeorm';

import { FavoritesRepository } from '../favorites.repository';
import { AddResult } from '../favorites.types';

/**
 * Unit tests for FavoritesRepository.addUnderLock ordering (Spec 22).
 *
 * A fake transaction manager records every SQL query and returns scripted results, letting us assert
 * the CRITICAL ordering: advisory lock → existence check FIRST (a duplicate short-circuits before any
 * count/limit) → count only when capped → insert with ON CONFLICT DO NOTHING. No real DB.
 */

interface ScriptedResult {
  readonly match: RegExp;
  readonly result: unknown;
}

/** A fake EntityManager that matches queries by regex and records the call order. */
class FakeManager {
  readonly calls: string[] = [];
  constructor(private readonly script: readonly ScriptedResult[]) {}

  async query<T = unknown>(sql: string, _params?: unknown[]): Promise<T> {
    this.calls.push(normalize(sql));
    for (const entry of this.script) {
      if (entry.match.test(sql)) {
        return entry.result as T;
      }
    }
    return [] as unknown as T;
  }
}

/** A fake DataSource whose transaction runs the callback with the fake manager. */
function fakeDataSource(manager: FakeManager): DataSource {
  return {
    transaction: async <T>(fn: (m: EntityManager) => Promise<T>): Promise<T> =>
      fn(manager as unknown as EntityManager),
  } as unknown as DataSource;
}

function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

const HOST = 'host-1';
const CLEANER = 'cleaner-1';

describe('FavoritesRepository.addUnderLock', () => {
  it('acquires the advisory lock, then checks existence FIRST', async () => {
    const manager = new FakeManager([
      { match: /pg_advisory_xact_lock/, result: [{ pg_advisory_xact_lock: '' }] },
      { match: /EXISTS/, result: [{ exists: false }] },
      { match: /INSERT INTO "favorites"/, result: [{ id: 'new-id' }] },
    ]);
    const repo = new FavoritesRepository(fakeDataSource(manager));
    await repo.addUnderLock(HOST, CLEANER, 5);

    const lockIdx = manager.calls.findIndex((c) => /pg_advisory_xact_lock/.test(c));
    const existsIdx = manager.calls.findIndex((c) => /EXISTS/.test(c));
    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(existsIdx).toBeGreaterThan(lockIdx);
  });

  it('a duplicate returns ALREADY_EXISTS BEFORE any count/limit check (even at cap)', async () => {
    const manager = new FakeManager([
      { match: /pg_advisory_xact_lock/, result: [] },
      { match: /EXISTS/, result: [{ exists: true }] },
    ]);
    const repo = new FavoritesRepository(fakeDataSource(manager));
    // limit=1 (at cap) but the pair exists → ALREADY_EXISTS, and NO count query runs.
    const result = await repo.addUnderLock(HOST, CLEANER, 1);
    expect(result).toBe(AddResult.ALREADY_EXISTS);
    expect(manager.calls.some((c) => /count\(\*\)/.test(c))).toBe(false);
    expect(manager.calls.some((c) => /INSERT INTO "favorites"/.test(c))).toBe(false);
  });

  it('OVER_LIMIT only for a genuinely new pair at/over the cap', async () => {
    const manager = new FakeManager([
      { match: /pg_advisory_xact_lock/, result: [] },
      { match: /EXISTS/, result: [{ exists: false }] },
      { match: /count\(\*\)/, result: [{ count: '5' }] },
    ]);
    const repo = new FavoritesRepository(fakeDataSource(manager));
    const result = await repo.addUnderLock(HOST, CLEANER, 5);
    expect(result).toBe(AddResult.OVER_LIMIT);
    expect(manager.calls.some((c) => /INSERT INTO "favorites"/.test(c))).toBe(false);
  });

  it('unlimited (limit === null) skips the count entirely and inserts', async () => {
    const manager = new FakeManager([
      { match: /pg_advisory_xact_lock/, result: [] },
      { match: /EXISTS/, result: [{ exists: false }] },
      { match: /INSERT INTO "favorites"/, result: [{ id: 'new-id' }] },
    ]);
    const repo = new FavoritesRepository(fakeDataSource(manager));
    const result = await repo.addUnderLock(HOST, CLEANER, null);
    expect(result).toBe(AddResult.CREATED);
    expect(manager.calls.some((c) => /count\(\*\)/.test(c))).toBe(false);
  });

  it('a new pair under the cap inserts with ON CONFLICT DO NOTHING → CREATED', async () => {
    const manager = new FakeManager([
      { match: /pg_advisory_xact_lock/, result: [] },
      { match: /EXISTS/, result: [{ exists: false }] },
      { match: /count\(\*\)/, result: [{ count: '2' }] },
      { match: /INSERT INTO "favorites"/, result: [{ id: 'new-id' }] },
    ]);
    const repo = new FavoritesRepository(fakeDataSource(manager));
    const result = await repo.addUnderLock(HOST, CLEANER, 5);
    expect(result).toBe(AddResult.CREATED);
    const insert = manager.calls.find((c) => /INSERT INTO "favorites"/.test(c));
    expect(insert).toMatch(/ON CONFLICT .* DO NOTHING/);
  });

  it('a concurrent insert swallowed by ON CONFLICT (no row returned) maps to ALREADY_EXISTS', async () => {
    const manager = new FakeManager([
      { match: /pg_advisory_xact_lock/, result: [] },
      { match: /EXISTS/, result: [{ exists: false }] },
      { match: /INSERT INTO "favorites"/, result: [] }, // ON CONFLICT → no returning row
    ]);
    const repo = new FavoritesRepository(fakeDataSource(manager));
    const result = await repo.addUnderLock(HOST, CLEANER, null);
    expect(result).toBe(AddResult.ALREADY_EXISTS);
  });
});

describe('FavoritesRepository.toView', () => {
  it('falls back to full_name when the profile display name is absent and maps safe fields only', () => {
    const view = FavoritesRepository.toView({
      cleaner_id: CLEANER,
      favorite_id: 'fav-1',
      display_name: null,
      full_name: 'Full Name',
      photo_storage_key: null,
      created_at: new Date('2024-05-01T12:00:00.000Z'),
      unavailable: true,
    });
    expect(view).toEqual({
      cleanerId: CLEANER,
      displayName: 'Full Name',
      avatarUrl: null,
      favoritedAt: '2024-05-01T12:00:00.000Z',
      unavailable: true,
    });
  });
});
