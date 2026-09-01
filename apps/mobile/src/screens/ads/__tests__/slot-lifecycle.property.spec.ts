/**
 * Property-based tests for the ad-slot lifecycle using fast-check.
 *
 * Property 13: Slot Lifecycle Idempotency. With a render-ready store
 * (providerReady + consentResolved) and adsEnabled=true, arbitrary sequences of
 * re-render and unmount/remount operations never throw and never change the
 * render decision. `shouldRender` stays stable at true across every re-render,
 * which is the observable form of request-once-per-mount semantics (a live list
 * re-render does not flip the decision or re-request the ad).
 *
 * Validates: Requirements 6.1, 6.3.
 * Library: fast-check (TypeScript). Minimum 100 iterations per property.
 */

import { renderHook } from '@testing-library/react-native';
import * as fc from 'fast-check';

// ─── Mocks (declared before importing the hook under test) ─────────────────────

const mockUseAdVisibility = jest.fn();
jest.mock('../../radar/hooks/useAdVisibility', () => ({
  useAdVisibility: () => mockUseAdVisibility(),
}));

import { RADAR_AD_SLOT_KEY } from '../ads.constants';
import { PersonalizationMode, type AdProvider } from '../ads.types';
import { useAdSlot } from '../useAdSlot';
import { useAdsStore } from '../useAds';

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** A trivially-ready provider stub. */
function readyProvider(): AdProvider {
  return {
    name: 'mock',
    initialize: jest.fn(),
    isReady: () => true,
    renderAdView: () => null,
  };
}

/** Put the store into a fully render-ready state. */
function setStoreReady(): void {
  useAdsStore.setState({
    provider: readyProvider(),
    providerReady: true,
    consentResolved: true,
    personalizationMode: PersonalizationMode.NON_PERSONALIZED,
  });
}

/** The two lifecycle operations we interleave. */
const OP = { RERENDER: 'rerender', REMOUNT: 'remount' } as const;
type LifecycleOp = (typeof OP)[keyof typeof OP];

const opArb = fc.constantFrom<LifecycleOp>(OP.RERENDER, OP.REMOUNT);
const opSequenceArb = fc.array(opArb, { minLength: 1, maxLength: 25 });

// ─── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  useAdsStore.getState().reset();
  mockUseAdVisibility.mockReturnValue({ adsEnabled: true, isLoading: false });
});

// ─── Property tests ──────────────────────────────────────────────────────────

describe('Ad Slot Lifecycle — Property-Based Tests', () => {
  // Feature: revenuecat-ads, Property 13: Slot Lifecycle Idempotency
  describe('Property 13: Slot Lifecycle Idempotency', () => {
    /**
     * Validates: Requirements 6.1, 6.3
     *
     * Arbitrary re-render / unmount+remount sequences keep shouldRender stable
     * (true for the ready radar slot) and never throw.
     */
    it('keeps shouldRender stable across arbitrary rerender/remount sequences', () => {
      fc.assert(
        fc.property(opSequenceArb, (ops) => {
          setStoreReady();

          let { result, rerender, unmount } = renderHook(() =>
            useAdSlot(RADAR_AD_SLOT_KEY),
          );
          expect(result.current.shouldRender).toBe(true);

          for (const op of ops) {
            if (op === OP.RERENDER) {
              rerender({});
            } else {
              unmount();
              setStoreReady();
              ({ result, rerender, unmount } = renderHook(() =>
                useAdSlot(RADAR_AD_SLOT_KEY),
              ));
            }
            // Decision is stable and correct after every operation.
            expect(result.current.shouldRender).toBe(true);
          }

          unmount();
        }),
        { numRuns: 100 },
      );
    });

    /**
     * Validates: Requirement 6.1
     *
     * Re-renders alone (no state change) never alter the decision — the
     * observable form of request-once semantics.
     */
    it('never changes the decision on pure re-renders', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 30 }), (rerenderCount) => {
          setStoreReady();
          const { result, rerender } = renderHook(() => useAdSlot(RADAR_AD_SLOT_KEY));

          const initial = result.current.shouldRender;
          expect(initial).toBe(true);

          for (let i = 0; i < rerenderCount; i += 1) {
            rerender({});
            expect(result.current.shouldRender).toBe(initial);
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});
