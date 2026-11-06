import * as fc from 'fast-check';
import {
  selectTargetPlayerIds,
  DeviceForTargeting,
} from '../device-registry.service';

/**
 * Property-based test (fast-check, >=100 iters) for Model B targeting.
 *
 * Feature: push-notifications, Property 6: Per-device consent targeting (Model B)
 * Validates: Requirements 1.1, 1.2, 1.3, 3.1
 */

const deviceArb: fc.Arbitrary<DeviceForTargeting> = fc.record({
  onesignalPlayerId: fc.uuid(),
  consentGranted: fc.boolean(),
  isStale: fc.boolean(),
});

describe('selectTargetPlayerIds — Model B targeting', () => {
  it('Property 6: resolved set equals exactly the consented, non-stale player ids', () => {
    // Feature: push-notifications, Property 6: Per-device consent targeting (Model B)
    fc.assert(
      fc.property(fc.array(deviceArb), (devices) => {
        // De-dup player ids so a random collision does not confuse the set comparison.
        const unique = new Map(devices.map((d) => [d.onesignalPlayerId, d]));
        const deviceList = [...unique.values()];

        const targeted = selectTargetPlayerIds(deviceList);
        const expected = deviceList
          .filter((d) => d.consentGranted && !d.isStale)
          .map((d) => d.onesignalPlayerId);

        expect(new Set(targeted)).toEqual(new Set(expected));

        // No opted-out or stale device is ever targeted.
        for (const id of targeted) {
          const device = unique.get(id)!;
          expect(device.consentGranted).toBe(true);
          expect(device.isStale).toBe(false);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('Property 6: an opted-out device on a multi-device user is never reached', () => {
    // Feature: push-notifications, Property 6: Per-device consent targeting (Model B)
    const devices: DeviceForTargeting[] = [
      { onesignalPlayerId: 'p1', consentGranted: true, isStale: false },
      { onesignalPlayerId: 'p2', consentGranted: false, isStale: false },
      { onesignalPlayerId: 'p3', consentGranted: true, isStale: true },
    ];
    expect(selectTargetPlayerIds(devices)).toEqual(['p1']);
  });
});
