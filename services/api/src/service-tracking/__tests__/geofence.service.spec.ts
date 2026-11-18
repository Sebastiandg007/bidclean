import * as fc from 'fast-check';

import { GeofenceService } from '../geofence.service';
import { ServiceSessionRepository } from '../service-session.repository';
import { EligibilityConfig, PositionSample } from '../service-tracking.types';

/**
 * Unit + property tests for GeofenceService (Spec 17).
 *
 * `isEligible` is pure (accuracy/age/clock-skew gates); `isWithinGeofence` delegates the PostGIS
 * computation to the repository (mocked here — the SQL itself is exercised by integration tests).
 */

const CONFIG: EligibilityConfig = {
  maxAccuracyM: 50,
  maxAgeMs: 30000,
  maxClockSkewMs: 5000,
};

function sample(overrides: Partial<PositionSample> = {}): PositionSample {
  return { lat: 4.6, lng: -74.08, accuracy: 10, at: 1_000_000, ...overrides };
}

function buildService(repo: Partial<ServiceSessionRepository> = {}): GeofenceService {
  return new GeofenceService(repo as ServiceSessionRepository);
}

describe('GeofenceService.isEligible', () => {
  const geofence = buildService();
  const now = 1_000_000;

  it('accepts a fresh, accurate, non-future sample at the boundaries', () => {
    expect(geofence.isEligible(sample({ accuracy: 50, at: now }), now, CONFIG)).toBe(true);
    expect(geofence.isEligible(sample({ accuracy: 50, at: now - 30000 }), now, CONFIG)).toBe(true);
    expect(geofence.isEligible(sample({ at: now + 5000 }), now, CONFIG)).toBe(true);
  });

  it('rejects a low-accuracy sample (gate only, never a radius correction)', () => {
    expect(geofence.isEligible(sample({ accuracy: 51 }), now, CONFIG)).toBe(false);
  });

  it('rejects a stale sample beyond max age', () => {
    expect(geofence.isEligible(sample({ at: now - 30001 }), now, CONFIG)).toBe(false);
  });

  it('rejects a future-dated sample beyond clock skew', () => {
    expect(geofence.isEligible(sample({ at: now + 5001 }), now, CONFIG)).toBe(false);
  });

  it('rejects non-finite accuracy/at', () => {
    expect(geofence.isEligible(sample({ accuracy: Number.NaN }), now, CONFIG)).toBe(false);
    expect(geofence.isEligible(sample({ at: Number.POSITIVE_INFINITY }), now, CONFIG)).toBe(false);
  });

  // Feature: service-tracking, Property 5: eligibility is exactly the accuracy/age/clock-skew conjunction.
  it('P5 (eligibility): eligible iff accuracy ≤ max AND age ≤ max AND at ≤ now + skew', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 500, noNaN: true }),
        fc.integer({ min: -120000, max: 120000 }),
        fc.integer({ min: 0, max: 2_000_000_000 }),
        (accuracy, offsetMs, serverNow) => {
          const at = serverNow - offsetMs;
          const s = sample({ accuracy, at });
          const expected =
            accuracy <= CONFIG.maxAccuracyM &&
            serverNow - at <= CONFIG.maxAgeMs &&
            at <= serverNow + CONFIG.maxClockSkewMs;
          expect(geofence.isEligible(s, serverNow, CONFIG)).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('GeofenceService.isWithinGeofence', () => {
  it('delegates to the repository snapshot evaluation and passes the reported point + radius', async () => {
    const evaluateGeofence = jest.fn().mockResolvedValue({ within: true, distanceM: 12 });
    const geofence = buildService({ evaluateGeofence });
    const result = await geofence.isWithinGeofence('sess-1', sample({ lat: 4.6, lng: -74.08 }), 50);
    expect(result).toEqual({ within: true, distanceM: 12 });
    expect(evaluateGeofence).toHaveBeenCalledWith('sess-1', -74.08, 4.6, 50);
  });

  it('returns null when the snapshot is unusable', async () => {
    const geofence = buildService({ evaluateGeofence: jest.fn().mockResolvedValue(null) });
    expect(await geofence.isWithinGeofence('sess-1', sample(), 50)).toBeNull();
  });
});
