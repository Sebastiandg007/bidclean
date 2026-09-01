/**
 * Property-based tests for consent-derived personalization using fast-check.
 *
 * Property 6: Consent Correctness. `derivePersonalizationMode` is pure and
 * platform-aware. It is TOTAL (always returns a valid PersonalizationMode),
 * only PERSONALIZED when the platform-relevant consent inputs permit, never
 * PERSONALIZED while UNRESOLVED, and — critically — on Android an `unavailable`
 * ATT status is NOT a denial (Android is invariant to ATT).
 *
 * Validates: Requirements 4.1, 4.2, 4.4.
 * Library: fast-check (TypeScript). Minimum 100 iterations per property.
 */

import * as fc from 'fast-check';

import {
  PersonalizationMode,
  type AdPlatform,
  type ConsentState,
  type ConsentStatus,
  type TrackingAuthorizationStatus,
} from '../ads.types';
import { derivePersonalizationMode } from '../personalization';

// ─── Generators ──────────────────────────────────────────────────────────────

const platformArb = fc.constantFrom<AdPlatform>('ios', 'android');

const attArb = fc.constantFrom<TrackingAuthorizationStatus>(
  'authorized',
  'denied',
  'restricted',
  'not_determined',
  'unavailable',
);

const umpArb = fc.constantFrom<ConsentStatus>(
  'obtained',
  'not_required',
  'required',
  'unknown',
);

const consentArb: fc.Arbitrary<ConsentState> = fc.record({
  trackingAuthorizationStatus: attArb,
  consentStatus: umpArb,
});

const ALL_MODES: readonly PersonalizationMode[] = [
  PersonalizationMode.PERSONALIZED,
  PersonalizationMode.NON_PERSONALIZED,
  PersonalizationMode.UNRESOLVED,
];

// ─── Oracle helpers (mirror the pure spec, not the implementation) ─────────────

/** UMP permits personalized serving (obtained or not required by region). */
function umpPermits(status: ConsentStatus): boolean {
  return status === 'obtained' || status === 'not_required';
}

// ─── Property tests ──────────────────────────────────────────────────────────

describe('Consent Personalization — Property-Based Tests', () => {
  // Feature: revenuecat-ads, Property 6: Consent Correctness
  describe('Property 6: Consent Correctness', () => {
    /**
     * Validates: Requirements 4.1, 4.2, 4.4
     *
     * Totality — every platform/consent combination returns a valid mode.
     */
    it('is total: always returns a valid PersonalizationMode', () => {
      fc.assert(
        fc.property(platformArb, consentArb, (platform, consent) => {
          const mode = derivePersonalizationMode(platform, consent);
          expect(ALL_MODES).toContain(mode);
        }),
        { numRuns: 200 },
      );
    });

    /**
     * Validates: Requirements 4.1, 4.4
     *
     * PERSONALIZED only when the platform-relevant inputs permit:
     *   iOS: ATT authorized AND UMP permits.
     *   Android: UMP permits (ATT ignored entirely).
     */
    it('is PERSONALIZED only when platform-relevant inputs permit', () => {
      fc.assert(
        fc.property(platformArb, consentArb, (platform, consent) => {
          const mode = derivePersonalizationMode(platform, consent);
          const { trackingAuthorizationStatus: att, consentStatus: ump } = consent;

          const permitted =
            platform === 'ios'
              ? att === 'authorized' && umpPermits(ump)
              : umpPermits(ump);

          if (mode === PersonalizationMode.PERSONALIZED) {
            expect(permitted).toBe(true);
          }
          if (!permitted) {
            expect(mode).not.toBe(PersonalizationMode.PERSONALIZED);
          }
        }),
        { numRuns: 200 },
      );
    });

    /**
     * Validates: Requirement 4.4
     *
     * UNRESOLVED implies not personalized (the mode itself is not PERSONALIZED).
     */
    it('never reports PERSONALIZED and UNRESOLVED at once (UNRESOLVED implies no personalization)', () => {
      fc.assert(
        fc.property(platformArb, consentArb, (platform, consent) => {
          const mode = derivePersonalizationMode(platform, consent);
          if (mode === PersonalizationMode.UNRESOLVED) {
            expect(mode).not.toBe(PersonalizationMode.PERSONALIZED);
          }
        }),
        { numRuns: 100 },
      );
    });

    /**
     * Validates: Requirements 4.1, 4.2
     *
     * Android treats ATT as irrelevant: for a fixed UMP status, the derived mode
     * is invariant across every ATT value (unavailable is never read as a denial).
     */
    it('is invariant to ATT on Android (unavailable is not a denial)', () => {
      const attValues: readonly TrackingAuthorizationStatus[] = [
        'authorized',
        'denied',
        'restricted',
        'not_determined',
        'unavailable',
      ];

      fc.assert(
        fc.property(umpArb, (ump) => {
          const modes = attValues.map((att) =>
            derivePersonalizationMode('android', {
              trackingAuthorizationStatus: att,
              consentStatus: ump,
            }),
          );
          const [first] = modes;
          for (const mode of modes) {
            expect(mode).toBe(first);
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});
