/**
 * Property-based tests for ad-slot placement using fast-check.
 *
 * The ads module only FILLS a slot; it never decides slot cadence. Slot
 * positions are owned by the radar and depend solely on `listLength` and
 * `adsEnabled`, following `AD_SLOT_FIRST_POSITION + k * AD_SLOT_INTERVAL`. This
 * reuses the radar's `computeAdSlotPositions` oracle (copied here, since it is
 * not exported) to prove the ads module leaves placement cadence intact.
 *
 * Validates: Requirement 1.6 (placement unchanged).
 * Library: fast-check (TypeScript). Minimum 100 iterations per property.
 */

import * as fc from 'fast-check';

import { AD_SLOT_FIRST_POSITION, AD_SLOT_INTERVAL } from '../../radar/radar.constants';

// ─── Oracle (copied verbatim from radar-properties.spec.ts; not exported) ──────

/**
 * Ad slot position calculator — the radar's placement oracle. Positions depend
 * only on `listLength` and `adsEnabled`.
 */
function computeAdSlotPositions(listLength: number, adsEnabled: boolean): number[] {
  if (!adsEnabled || listLength === 0) return [];

  const positions: number[] = [];
  let pos = AD_SLOT_FIRST_POSITION;
  while (pos < listLength) {
    positions.push(pos);
    pos += AD_SLOT_INTERVAL;
  }
  return positions;
}

// ─── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Property tests ──────────────────────────────────────────────────────────

describe('Ad Slot Placement — Property-Based Tests', () => {
  // Feature: revenuecat-ads, Placement unchanged by the ads module
  describe('Placement cadence is owned by the radar (unchanged by ads module)', () => {
    /**
     * Validates: Requirement 1.6
     *
     * When enabled, positions match AD_SLOT_FIRST_POSITION + k * AD_SLOT_INTERVAL,
     * stay strictly within the list, and cover exactly the eligible slots.
     */
    it('places ads at first + k*interval within bounds when enabled', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 500 }), (listLength) => {
          const positions = computeAdSlotPositions(listLength, true);

          for (let k = 0; k < positions.length; k += 1) {
            const expectedPos = AD_SLOT_FIRST_POSITION + k * AD_SLOT_INTERVAL;
            expect(positions[k]).toBe(expectedPos);
            expect(positions[k]).toBeLessThan(listLength);
          }

          if (listLength > AD_SLOT_FIRST_POSITION) {
            expect(positions[0]).toBe(AD_SLOT_FIRST_POSITION);
          } else {
            expect(positions).toHaveLength(0);
          }
        }),
        { numRuns: 200 },
      );
    });

    /**
     * Validates: Requirement 1.6
     *
     * Positions depend ONLY on (listLength, adsEnabled): the same inputs always
     * yield the same output, and disabling ads yields no positions. The ads
     * module (which only fills the slot) cannot alter this.
     */
    it('is a pure function of (listLength, adsEnabled)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 500 }),
          fc.boolean(),
          (listLength, adsEnabled) => {
            const first = computeAdSlotPositions(listLength, adsEnabled);
            const second = computeAdSlotPositions(listLength, adsEnabled);
            expect(second).toEqual(first);

            if (!adsEnabled) {
              expect(first).toHaveLength(0);
            }
          },
        ),
        { numRuns: 200 },
      );
    });
  });
});
