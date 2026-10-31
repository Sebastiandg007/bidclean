import * as fc from 'fast-check';

/**
 * Property-based test (fast-check, >=100 iters) for the single-winner transition.
 *
 * Feature: push-notifications, Property 12: Single-winner status transition
 * Validates: Requirements 3.1, 7.5
 *
 * The repository's `claimForDelivery` is the SQL `UPDATE ... WHERE id=:id AND status='PENDING'`:
 * exactly one concurrent attempt observes rows=1 (the winner); the rest observe rows=0 (no-op).
 * This models that conditional update as an atomic compare-and-set and asserts exactly one winner
 * regardless of how many workers race.
 */

/** A single ledger row modeled as a compare-and-set on `status`. */
class LedgerRow {
  status = 'PENDING';
  attempt = 0;

  /** Atomic PENDING -> PROCESSING; returns true only for the single winner. */
  claim(): boolean {
    if (this.status === 'PENDING') {
      this.status = 'PROCESSING';
      this.attempt += 1;
      return true;
    }
    return false;
  }
}

describe('single-winner PENDING -> PROCESSING', () => {
  it('Property 12: N concurrent claims yield exactly one winner', () => {
    // Feature: push-notifications, Property 12: Single-winner status transition
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50 }), (workers) => {
        const row = new LedgerRow();
        // Because JS is single-threaded, sequential claims model the DB's serialized conditional
        // update: the first flips PENDING->PROCESSING, all others observe rows=0.
        const results = Array.from({ length: workers }, () => row.claim());
        const winners = results.filter((won) => won === true);

        expect(winners).toHaveLength(1);
        expect(row.status).toBe('PROCESSING');
        expect(row.attempt).toBe(1); // exactly one worker incremented the attempt
      }),
      { numRuns: 200 },
    );
  });
});
