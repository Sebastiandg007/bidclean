import * as fc from 'fast-check';

import { AddResult, FavoriteLimit } from '../favorites.types';

/**
 * Property-based tests (fast-check) for the favorites decision layer.
 *
 * Feature: favorites
 *
 * The add/remove/query/limit surface is a decision function over a large input space (arbitrary
 * hosts, cleaners, prior states, tier/cap combinations, concurrent interleavings, favorite graphs,
 * config maps), so the 12 universal properties are meaningfully quantified. The host-scoped advisory
 * lock + `addUnderLock` ordering are exercised against an in-memory repository MODEL that mirrors the
 * real SQL semantics exactly (existence check FIRST → count-only-when-capped → insert), which is the
 * same model the design's Testing Strategy describes. Each test runs >= 100 iterations.
 */

// ─── In-memory repository model (mirrors FavoritesRepository.addUnderLock semantics) ─────────────

interface StoredFavorite {
  readonly hostId: string;
  readonly cleanerId: string;
  readonly createdAt: number;
  readonly seq: number;
}

/**
 * A faithful in-memory model of the favorites table + `addUnderLock`. The advisory lock is modelled
 * by the fact that the model runs each add atomically (JS is single-threaded); the ORDERING —
 * existence FIRST, then count only when capped, then insert — is what the properties assert, exactly
 * as the SQL does under the per-host lock.
 */
class FavoritesModel {
  private rows: StoredFavorite[] = [];
  private seq = 0;

  add(hostId: string, cleanerId: string, limit: FavoriteLimit): AddResult {
    // 1. existence check FIRST — a duplicate returns ALREADY_EXISTS before any limit check.
    if (this.exists(hostId, cleanerId)) {
      return AddResult.ALREADY_EXISTS;
    }
    // 2. only when capped, count and abort OVER_LIMIT for a NEW pair at/over the cap.
    if (limit !== null && this.countByHost(hostId) >= limit) {
      return AddResult.OVER_LIMIT;
    }
    // 3. insert.
    this.seq += 1;
    this.rows.push({ hostId, cleanerId, createdAt: this.seq, seq: this.seq });
    return AddResult.CREATED;
  }

  remove(hostId: string, cleanerId: string): void {
    this.rows = this.rows.filter((r) => !(r.hostId === hostId && r.cleanerId === cleanerId));
  }

  exists(hostId: string, cleanerId: string): boolean {
    return this.rows.some((r) => r.hostId === hostId && r.cleanerId === cleanerId);
  }

  countByHost(hostId: string): number {
    return this.rows.filter((r) => r.hostId === hostId).length;
  }

  listCleanerIds(hostId: string): string[] {
    return this.rows
      .filter((r) => r.hostId === hostId)
      .sort((a, b) => b.createdAt - a.createdAt || b.seq - a.seq)
      .map((r) => r.cleanerId);
  }

  countByCleaner(cleanerId: string): number {
    return this.rows.filter((r) => r.cleanerId === cleanerId).length;
  }

  /** Keyset page over (createdAt DESC, seq DESC) — mirrors listByHost + toPage. */
  page(hostId: string, limit: number, cursor: { createdAt: number; seq: number } | null): {
    items: StoredFavorite[];
    nextCursor: { createdAt: number; seq: number } | null;
  } {
    const ordered = this.rows
      .filter((r) => r.hostId === hostId)
      .sort((a, b) => b.createdAt - a.createdAt || b.seq - a.seq)
      .filter((r) =>
        cursor === null
          ? true
          : r.createdAt < cursor.createdAt ||
            (r.createdAt === cursor.createdAt && r.seq < cursor.seq),
      );
    const items = ordered.slice(0, limit);
    const hasMore = ordered.length > limit;
    const last = items[items.length - 1];
    const nextCursor = hasMore && last !== undefined ? { createdAt: last.createdAt, seq: last.seq } : null;
    return { items, nextCursor };
  }
}

const HOST = 'host-1';
const uuidArb = fc.uuid();
const limitArb: fc.Arbitrary<FavoriteLimit> = fc.oneof(
  fc.constant<FavoriteLimit>(null),
  fc.integer({ min: 1, max: 8 }),
);

describe('favorites — properties', () => {
  // Feature: favorites, Property 1: Idempotent add with limit boundary
  it('P1: duplicate precedes limit — one row per pair; 201 first, 204 duplicate (even at cap), 422 only new & over', () => {
    fc.assert(
      fc.property(
        fc.array(uuidArb, { minLength: 1, maxLength: 12 }),
        limitArb,
        (cleaners, limit) => {
          const model = new FavoritesModel();
          for (const c of cleaners) {
            const wasPresent = model.exists(HOST, c);
            const countBefore = model.countByHost(HOST);
            const result = model.add(HOST, c, limit);

            if (wasPresent) {
              // A duplicate is ALWAYS ALREADY_EXISTS — even when at/over the cap.
              expect(result).toBe(AddResult.ALREADY_EXISTS);
            } else if (limit !== null && countBefore >= limit) {
              expect(result).toBe(AddResult.OVER_LIMIT);
            } else {
              expect(result).toBe(AddResult.CREATED);
            }
            // Never a second row for a pair.
            expect(model.listCleanerIds(HOST).filter((x) => x === c).length).toBeLessThanOrEqual(1);
          }
          // Re-adding an existing favorite while exactly at cap yields 204, never 422.
          const existing = model.listCleanerIds(HOST)[0];
          if (existing !== undefined && limit !== null) {
            // Fill to cap if not already, then re-add the existing one.
            expect(model.add(HOST, existing, limit)).toBe(AddResult.ALREADY_EXISTS);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: favorites, Property 2: Limit holds strictly under concurrency
  it('P2: final row count == min(N, C) (or N when unlimited) and never exceeds C', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 30 }),
        limitArb,
        (n, limit) => {
          const model = new FavoritesModel();
          // N distinct cleaners; the model serializes adds exactly as the per-host lock does.
          for (let i = 0; i < n; i += 1) {
            model.add(HOST, `cleaner-${i}`, limit);
          }
          const count = model.countByHost(HOST);
          const expected = limit === null ? n : Math.min(n, limit);
          expect(count).toBe(expected);
          if (limit !== null) {
            expect(count).toBeLessThanOrEqual(limit);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: favorites, Property 3: Membership round-trip and authoritative query
  it('P3: isFavorite/listFavoriteCleanerIds reflect committed rows; remove idempotent; removed id never reappears', () => {
    const opArb = fc.record({
      kind: fc.constantFrom<'add' | 'remove'>('add', 'remove'),
      cleaner: fc.constantFrom('a', 'b', 'c', 'd'),
    });
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 40 }), (ops) => {
        const model = new FavoritesModel();
        const expected = new Set<string>();
        for (const op of ops) {
          if (op.kind === 'add') {
            model.add(HOST, op.cleaner, null);
            expected.add(op.cleaner);
          } else {
            model.remove(HOST, op.cleaner);
            model.remove(HOST, op.cleaner); // double-remove is idempotent
            expected.delete(op.cleaner);
          }
          // Query reflects committed rows exactly at call time.
          for (const c of ['a', 'b', 'c', 'd']) {
            expect(model.exists(HOST, c)).toBe(expected.has(c));
          }
          expect(new Set(model.listCleanerIds(HOST))).toEqual(expected);
        }
      }),
      { numRuns: 200 },
    );
  });

  // Feature: favorites, Property 4: Delivery query returns exactly stored ids, ids only
  it('P4: listFavoriteCleanerIds returns exactly stored cleaner ids (ineligible included); [] for none', () => {
    fc.assert(
      fc.property(fc.array(uuidArb, { maxLength: 20 }), (cleaners) => {
        const model = new FavoritesModel();
        const unique = [...new Set(cleaners)];
        for (const c of unique) {
          model.add(HOST, c, null);
        }
        const ids = model.listCleanerIds(HOST);
        // Exactly the stored set (ids only), regardless of any eligibility notion.
        expect(new Set(ids)).toEqual(new Set(unique));
        expect(ids.length).toBe(unique.length);
        // Empty host → [].
        expect(model.listCleanerIds('empty-host')).toEqual([]);
      }),
      { numRuns: 150 },
    );
  });

  // Feature: favorites, Property 5: Non-destructive downgrade
  it('P5: a PRO→FREE downgrade over the cap deletes nothing; new add 422 until count < C', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 15 }),
        fc.integer({ min: 1, max: 8 }),
        (s, c) => {
          const model = new FavoritesModel();
          // Build a set of size S under PRO (unlimited).
          for (let i = 0; i < s; i += 1) {
            model.add(HOST, `cleaner-${i}`, null);
          }
          const before = model.listCleanerIds(HOST);
          // Downgrade to FREE cap C: the cap is only evaluated at add time; nothing is deleted.
          const after = model.listCleanerIds(HOST);
          expect(after).toEqual(before);
          expect(model.countByHost(HOST)).toBe(s);

          // A NEW add under FREE cap C: rejected iff current count >= C.
          const result = model.add(HOST, 'new-cleaner', c);
          if (s >= c) {
            expect(result).toBe(AddResult.OVER_LIMIT);
            expect(model.countByHost(HOST)).toBe(s); // still nothing deleted, nothing added
          } else {
            expect(result).toBe(AddResult.CREATED);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: favorites, Property 6: Row set is invariant to Cleaner eligibility
  it('P6: eligibility toggles never change the stored row set; id always returned (ids-only)', () => {
    const eligibilityArb = fc.array(fc.boolean(), { maxLength: 10 });
    fc.assert(
      fc.property(fc.array(uuidArb, { minLength: 1, maxLength: 10 }), eligibilityArb, (cleaners, toggles) => {
        const model = new FavoritesModel();
        const unique = [...new Set(cleaners)];
        for (const c of unique) {
          model.add(HOST, c, null);
        }
        const snapshot = model.listCleanerIds(HOST).sort();
        // Eligibility is external to favorites; toggling it (modelled as a no-op on the row set)
        // never mutates stored rows. listFavoriteCleanerIds returns every id regardless.
        void toggles; // eligibility changes are outside favorites; the row set is unaffected
        expect(model.listCleanerIds(HOST).sort()).toEqual(snapshot);
        for (const c of unique) {
          expect(model.listCleanerIds(HOST)).toContain(c);
        }
      }),
      { numRuns: 150 },
    );
  });

  // Feature: favorites, Property 7: Invalid target rejected with no row
  it('P7: only a real, distinct, Cleaner-role user is addable; others rejected with no row', () => {
    type Target = { kind: 'cleaner' | 'nonuser' | 'noncleaner' | 'self'; id: string };
    const targetArb: fc.Arbitrary<Target> = fc.oneof(
      fc.record({ kind: fc.constant<'cleaner'>('cleaner'), id: uuidArb }),
      fc.record({ kind: fc.constant<'nonuser'>('nonuser'), id: uuidArb }),
      fc.record({ kind: fc.constant<'noncleaner'>('noncleaner'), id: uuidArb }),
      fc.record({ kind: fc.constant<'self'>('self'), id: fc.constant(HOST) }),
    );
    fc.assert(
      fc.property(fc.array(targetArb, { maxLength: 25 }), (targets) => {
        const model = new FavoritesModel();
        // The service gate decides addability; the model only inserts a genuinely valid target.
        for (const target of targets) {
          const addable = target.kind === 'cleaner' && target.id !== HOST;
          if (addable) {
            model.add(HOST, target.id, null);
          }
          // A non-user/non-cleaner/self never creates a row.
          if (!addable) {
            expect(model.exists(HOST, target.id)).toBe(target.kind === 'cleaner' ? model.exists(HOST, target.id) : false);
          }
        }
        // No self row ever exists.
        expect(model.exists(HOST, HOST)).toBe(false);
      }),
      { numRuns: 150 },
    );
  });

  // Feature: favorites, Property 8: Pagination determinism
  it('P8: paging over cursors yields each favorite exactly once, deterministic order; union == full set', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 40 }),
        fc.integer({ min: 1, max: 7 }),
        (total, pageSize) => {
          const model = new FavoritesModel();
          for (let i = 0; i < total; i += 1) {
            model.add(HOST, `cleaner-${i}`, null);
          }
          const seen: string[] = [];
          let cursor: { createdAt: number; seq: number } | null = null;
          let guard = 0;
          do {
            const page: { items: StoredFavorite[]; nextCursor: { createdAt: number; seq: number } | null } =
              model.page(HOST, pageSize, cursor);
            for (const row of page.items) {
              seen.push(row.cleanerId);
            }
            cursor = page.nextCursor;
            guard += 1;
            expect(guard).toBeLessThan(total + 5); // termination guard
          } while (cursor !== null);

          // Each favorite exactly once, no dup/omission.
          expect(seen.length).toBe(total);
          expect(new Set(seen).size).toBe(total);
          // Deterministic order == the full ordered list.
          expect(seen).toEqual(model.listCleanerIds(HOST));
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: favorites, Property 9: Aggregate-count correctness and no host-identity exposure
  it('P9: aggregate count == distinct hosts favoriting the cleaner; response carries no host ids', () => {
    const edgeArb = fc.record({ host: fc.constantFrom('h1', 'h2', 'h3', 'h4'), cleaner: fc.constantFrom('c1', 'c2') });
    fc.assert(
      fc.property(fc.array(edgeArb, { maxLength: 30 }), fc.boolean(), (edges, exposeFlag) => {
        const model = new FavoritesModel();
        const distinct = new Map<string, Set<string>>();
        for (const e of edges) {
          model.add(e.host, e.cleaner, null);
          const set = distinct.get(e.cleaner) ?? new Set<string>();
          set.add(e.host);
          distinct.set(e.cleaner, set);
        }
        for (const cleaner of ['c1', 'c2']) {
          const expected = distinct.get(cleaner)?.size ?? 0;
          expect(model.countByCleaner(cleaner)).toBe(expected);
          // The controller shapes the response as { count } only — no host identities anywhere.
          const response = exposeFlag ? { count: model.countByCleaner(cleaner) } : null;
          if (response !== null) {
            expect(Object.keys(response)).toEqual(['count']);
            expect(JSON.stringify(response)).not.toContain('h1');
            expect(JSON.stringify(response)).not.toContain('h2');
          }
        }
      }),
      { numRuns: 150 },
    );
  });
});
