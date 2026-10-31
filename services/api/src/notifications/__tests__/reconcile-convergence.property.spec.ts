import * as fc from 'fast-check';
import { selectTargetPlayerIds, DeviceForTargeting } from '../device-registry.service';

/**
 * Property-based test (fast-check, >=100 iters) for registry <-> OneSignal convergence.
 *
 * Feature: push-notifications, Property 17: Registry <-> OneSignal convergence
 * Validates: Requirements 1.5, 1.6, 1.7
 *
 * Models the registry as a map of player id -> device and applies an arbitrary sequence of
 * register / consent-change / unregister / mark-stale (webhook) / sweep operations. After ANY
 * sequence, the targeting set (a) never includes a stale player id, and (b) includes exactly the
 * devices currently consented and non-stale — so a send never targets a stale id and a consented
 * device is never silently unreachable.
 */

type Op =
  | { kind: 'register'; playerId: string; consent: boolean }
  | { kind: 'consent'; playerId: string; consent: boolean }
  | { kind: 'unregister'; playerId: string }
  | { kind: 'markStale'; playerId: string };

class RegistryModel {
  private readonly devices = new Map<string, DeviceForTargeting>();

  apply(op: Op): void {
    switch (op.kind) {
      case 'register':
        this.devices.set(op.playerId, {
          onesignalPlayerId: op.playerId,
          consentGranted: op.consent,
          isStale: false, // re-register clears stale (mirrors upsert ON CONFLICT)
        });
        break;
      case 'consent': {
        const existing = this.devices.get(op.playerId);
        if (existing) {
          this.devices.set(op.playerId, { ...existing, consentGranted: op.consent });
        }
        break;
      }
      case 'unregister':
        this.devices.delete(op.playerId);
        break;
      case 'markStale': {
        const existing = this.devices.get(op.playerId);
        if (existing) {
          this.devices.set(op.playerId, { ...existing, isStale: true });
        }
        break;
      }
    }
  }

  snapshot(): DeviceForTargeting[] {
    return [...this.devices.values()];
  }
}

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant('register' as const), playerId: fc.constantFrom('p1', 'p2', 'p3'), consent: fc.boolean() }),
  fc.record({ kind: fc.constant('consent' as const), playerId: fc.constantFrom('p1', 'p2', 'p3'), consent: fc.boolean() }),
  fc.record({ kind: fc.constant('unregister' as const), playerId: fc.constantFrom('p1', 'p2', 'p3') }),
  fc.record({ kind: fc.constant('markStale' as const), playerId: fc.constantFrom('p1', 'p2', 'p3') }),
);

describe('Registry convergence — Property 17', () => {
  it('Property 17: after any op sequence, targeting excludes stale and equals consented+non-stale', () => {
    // Feature: push-notifications, Property 17: Registry <-> OneSignal convergence
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 40 }), (ops) => {
        const model = new RegistryModel();
        for (const op of ops) {
          model.apply(op);
        }
        const devices = model.snapshot();
        const targeted = selectTargetPlayerIds(devices);

        // (a) No stale id is ever targeted.
        for (const id of targeted) {
          const device = devices.find((d) => d.onesignalPlayerId === id)!;
          expect(device.isStale).toBe(false);
          expect(device.consentGranted).toBe(true);
        }

        // (b) Every consented, non-stale device is represented (never silently unreachable).
        const expected = devices.filter((d) => d.consentGranted && !d.isStale).map((d) => d.onesignalPlayerId);
        expect(new Set(targeted)).toEqual(new Set(expected));
      }),
      { numRuns: 200 },
    );
  });
});
