import * as fc from 'fast-check';
import { NotificationCategory } from '../notifications.types';
import {
  PreferenceService,
  DecisionInput,
  PreferenceSnapshot,
} from '../preference.service';
import { NotificationTypeMetadata } from '../notification-type.registry';

/**
 * Property-based tests (fast-check, >=100 iterations) for the pure delivery decision.
 *
 * Feature: push-notifications
 * - Property 8: Metadata-driven suppression, calls exempt (Requirements 4.1, 4.2, 4.4)
 * - Property 9: Default preferences from metadata (Requirements 4.4)
 * - Property 10: Foreground coordination is fail-open (Requirements 4.3)
 */

const service = new PreferenceService();

const categoryArb = fc.constantFrom(...Object.values(NotificationCategory));
const priorityArb = fc.constantFrom('HIGH', 'NORMAL', 'LOW') as fc.Arbitrary<
  NotificationTypeMetadata['priority']
>;
const quietBehaviorArb = fc.constantFrom('RESPECT', 'EXEMPT') as fc.Arbitrary<
  NotificationTypeMetadata['quietHoursBehavior']
>;

const metadataArb: fc.Arbitrary<NotificationTypeMetadata> = fc.record({
  priority: priorityArb,
  category: categoryArb,
  quietHoursBehavior: quietBehaviorArb,
  defaultEnabled: fc.boolean(),
});

/** Arbitrary preferences with optional quiet-hours window and per-category overrides. */
const prefsArb: fc.Arbitrary<PreferenceSnapshot | null> = fc.option(
  fc.record({
    categoryOptOut: fc.dictionary(categoryArb, fc.boolean()),
    quietHoursStart: fc.option(fc.constantFrom('22:00', '00:00', '08:30'), { nil: null }),
    quietHoursEnd: fc.option(fc.constantFrom('07:00', '23:59', '18:00'), { nil: null }),
    quietHoursTimezone: fc.option(fc.constant('America/Bogota'), { nil: null }),
  }),
  { nil: null },
);

const inputArb: fc.Arbitrary<DecisionInput> = fc.record({
  metadata: metadataArb,
  prefs: prefsArb,
  hasConsentedDevice: fc.boolean(),
  foregroundKnownActive: fc.boolean(),
  localNowMinutes: fc.option(fc.integer({ min: 0, max: 1439 }), { nil: null }),
});

describe('PreferenceService.decide — properties', () => {
  it('Property 8: metadata-driven suppression, calls exempt', () => {
    // Feature: push-notifications, Property 8: Metadata-driven suppression, calls exempt
    fc.assert(
      fc.property(inputArb, (input) => {
        const decision = service.decide(input);

        // A full device unregister suppresses everything, including EXEMPT.
        if (!input.hasConsentedDevice) {
          expect(decision).toEqual({ kind: 'SUPPRESS', reason: 'no-device' });
          return;
        }

        // EXEMPT/HIGH (incoming call) delivers regardless of quiet-hours / non-urgent opt-outs.
        if (input.metadata.quietHoursBehavior === 'EXEMPT') {
          expect(decision).toEqual({ kind: 'DELIVER' });
        }
      }),
      { numRuns: 200 },
    );
  });

  it('Property 9: default preferences from metadata', () => {
    // Feature: push-notifications, Property 9: Default preferences from metadata
    fc.assert(
      fc.property(metadataArb, fc.boolean(), (metadata, foregroundKnownActive) => {
        // RESPECT type, consented device, NO preference override for its category, no quiet hours.
        const respectMeta: NotificationTypeMetadata = { ...metadata, quietHoursBehavior: 'RESPECT' };
        const input: DecisionInput = {
          metadata: respectMeta,
          prefs: { categoryOptOut: {}, quietHoursStart: null, quietHoursEnd: null, quietHoursTimezone: null },
          hasConsentedDevice: true,
          foregroundKnownActive,
          localNowMinutes: null,
        };
        const decision = service.decide(input);

        if (respectMeta.defaultEnabled === false) {
          // Absent override + defaultEnabled=false => opted-out by default.
          expect(decision).toEqual({ kind: 'SUPPRESS', reason: 'opted-out' });
        } else if (foregroundKnownActive) {
          expect(decision).toEqual({ kind: 'SUPPRESS', reason: 'foreground' });
        } else {
          expect(decision).toEqual({ kind: 'DELIVER' });
        }
      }),
      { numRuns: 200 },
    );
  });

  it('Property 10: foreground coordination is fail-open', () => {
    // Feature: push-notifications, Property 10: Foreground coordination is fail-open
    fc.assert(
      fc.property(metadataArb, fc.boolean(), (metadata, foregroundKnownActive) => {
        // Enabled RESPECT type, consented device, opted-in category, no quiet hours.
        const meta: NotificationTypeMetadata = {
          ...metadata,
          quietHoursBehavior: 'RESPECT',
          defaultEnabled: true,
        };
        const input: DecisionInput = {
          metadata: meta,
          prefs: { categoryOptOut: {}, quietHoursStart: null, quietHoursEnd: null, quietHoursTimezone: null },
          hasConsentedDevice: true,
          foregroundKnownActive,
          localNowMinutes: null,
        };
        const decision = service.decide(input);

        // Suppress ONLY when foreground is reliably known active; otherwise deliver (fail-open).
        if (foregroundKnownActive) {
          expect(decision).toEqual({ kind: 'SUPPRESS', reason: 'foreground' });
        } else {
          expect(decision).toEqual({ kind: 'DELIVER' });
        }
      }),
      { numRuns: 200 },
    );
  });

  it('Property 10: EXEMPT types (calls) always fail open even when foreground is known active', () => {
    // Feature: push-notifications, Property 10: Foreground coordination is fail-open
    fc.assert(
      fc.property(metadataArb, (metadata) => {
        const meta: NotificationTypeMetadata = { ...metadata, quietHoursBehavior: 'EXEMPT' };
        const decision = service.decide({
          metadata: meta,
          prefs: { categoryOptOut: { [meta.category]: false }, quietHoursStart: '00:00', quietHoursEnd: '23:59', quietHoursTimezone: 'America/Bogota' },
          hasConsentedDevice: true,
          foregroundKnownActive: true,
          localNowMinutes: 600,
        });
        // EXEMPT delivers regardless of foreground/quiet-hours/opt-out (device is consented).
        expect(decision).toEqual({ kind: 'DELIVER' });
      }),
      { numRuns: 100 },
    );
  });
});
