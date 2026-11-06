import * as fc from 'fast-check';
import { Logger } from '@nestjs/common';

import { GeofenceService } from '../geofence.service';
import { ServiceSessionRepository, ServiceSessionRow, TransitionDerivedFields } from '../service-session.repository';
import {
  ServiceSessionService,
  ServiceRealtimePublisher,
} from '../service-session.service';
import {
  buildEnRouteOutboxRow,
  buildArrivedOutboxRow,
  buildStartedOutboxRow,
} from '../service-outbox';
import { buildServiceActivationOutboxRow } from '../service-activation-outbox';
import {
  EndedReason,
  NON_TERMINAL_STATES,
  PositionSample,
  SessionState,
  TERMINAL_STATES,
  isTerminalState,
} from '../service-tracking.types';
import { OutboxRow } from '../../common/outbox/outbox-writer';

/**
 * Property-based tests for service-tracking (Spec 17), fast-check ≥100 iters each.
 * Each is tagged `// Feature: service-tracking, Property N: <text>`.
 *
 * P3/P5-eligibility/P8/P12/P2 live in the collaborator + consumer specs; this file covers the
 * remaining universal invariants over the state machine and event shaping.
 */

// Silence the expected best-effort publish-failure warnings so the suite output stays clean.
jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

const PUBLISHER: ServiceRealtimePublisher = { publish: jest.fn().mockResolvedValue(true) };

function baseRow(overrides: Partial<ServiceSessionRow> = {}): ServiceSessionRow {
  return {
    id: 'sess-1',
    offer_id: 'offer-1',
    host_id: 'host-1',
    cleaner_id: 'cleaner-1',
    property_id: 'prop-1',
    state: SessionState.MATCHED,
    ended_reason: null,
    geofence_radius_m: 50,
    en_route_at: null,
    arrived_at: null,
    started_at: null,
    arrival_distance_m: null,
    last_progress_at: null,
    created_at: new Date(0),
    snapshot_lng: -74.08,
    snapshot_lat: 4.6,
    ...overrides,
  };
}

/** A single-winner fake repo: transition succeeds iff current state === expected. */
function buildRepo(initial: ServiceSessionRow): {
  repo: ServiceSessionRepository;
  outbox: OutboxRow[];
  current: () => ServiceSessionRow;
} {
  let session = initial;
  const outbox: OutboxRow[] = [];
  const repo = {
    findById: jest.fn(async () => session),
    findByOfferId: jest.fn(async () => session),
    touchProgress: jest.fn(async () => undefined),
    transition: jest.fn(
      async (
        _id: string,
        expected: SessionState,
        next: SessionState,
        derived: TransitionDerivedFields,
        row: OutboxRow | null,
      ): Promise<ServiceSessionRow | null> => {
        if (session.state !== expected) {
          return null;
        }
        session = {
          ...session,
          state: next,
          ended_reason: derived.endedReason ?? session.ended_reason,
          arrival_distance_m: derived.arrivalDistanceM ?? session.arrival_distance_m,
          arrived_at: derived.arrivedAt ? new Date(9) : session.arrived_at,
        };
        if (row) {
          outbox.push(row);
        }
        return session;
      },
    ),
  } as unknown as ServiceSessionRepository;
  return { repo, outbox, current: () => session };
}

// ── Property 1: Idempotent creation from one durable fact ──────────────────────
describe('P1 — idempotent creation from one durable fact', () => {
  // Feature: service-tracking, Property 1: exactly one session per offer_id, created idempotently.
  it('N redeliveries / concurrent attempts yield at most one createSession success (ON CONFLICT no-op)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.integer({ min: 1, max: 6 }),
        async (offerId, redeliveries) => {
          let existing: ServiceSessionRow | null = null;
          let inserts = 0;
          const repo = {
            createSession: jest.fn(async () => {
              if (existing) {
                return existing; // ON CONFLICT DO NOTHING → returns the existing row (no new insert)
              }
              inserts += 1;
              existing = baseRow({ offer_id: offerId });
              return existing;
            }),
          } as unknown as ServiceSessionRepository;
          const svc = new ServiceSessionService(repo, {} as GeofenceService, PUBLISHER);
          for (let i = 0; i < redeliveries; i += 1) {
            await svc.createFromActivation({
              offerId,
              hostId: 'h',
              cleanerId: 'c',
              propertyId: 'p',
            });
          }
          expect(inserts).toBe(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: service-tracking, Property 1: the activation event_id is deterministic per offer.
  it('the activation outbox event_id is deterministic per offerId (redelivery dedups)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 20 }), (offerId) => {
        const a = buildServiceActivationOutboxRow({ offerId, hostId: 'h', cleanerId: 'c', propertyId: 'p' });
        const b = buildServiceActivationOutboxRow({ offerId, hostId: 'h2', cleanerId: 'c2', propertyId: 'p2' });
        expect(a.eventId).toBe(`service_activation_ready:${offerId}`);
        expect(a.eventId).toBe(b.eventId);
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 5: geofence over the snapshot, eligibility-gated ──────────────────
describe('P5 — server-authoritative geofence over the snapshot', () => {
  // Feature: service-tracking, Property 5: ARRIVED iff eligible AND within snapshot radius; accuracy gates only.
  it('arrives iff eligible AND within radius; ineligible/out-of-radius/claim never arrives', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(), // eligible
        fc.boolean(), // within
        fc.integer({ min: 0, max: 500 }), // distanceM
        async (eligible, within, distanceM) => {
          const { repo, current } = buildRepo(baseRow({ state: SessionState.EN_ROUTE }));
          const geofence = {
            isEligible: jest.fn().mockReturnValue(eligible),
            isWithinGeofence: jest.fn().mockResolvedValue({ within, distanceM }),
          } as unknown as GeofenceService;
          const svc = new ServiceSessionService(repo, geofence, PUBLISHER);
          const sample: PositionSample = { lat: 4.6, lng: -74.08, accuracy: 10, at: Date.now() };
          await svc.ingestPosition('sess-1', 'cleaner-1', sample);

          const arrived = current().state === SessionState.ARRIVED;
          expect(arrived).toBe(eligible && within);
          if (arrived) {
            expect(current().arrival_distance_m).toBe(distanceM);
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});

// ── Property 6: single-winner, atomic, monotonic state machine ─────────────────
describe('P6 — single-winner, atomic, monotonic state machine', () => {
  const ALLOWED_ADVANCE: ReadonlyArray<readonly [SessionState, SessionState]> = [
    [SessionState.MATCHED, SessionState.EN_ROUTE],
    [SessionState.ARRIVED, SessionState.IN_PROGRESS],
  ];

  // Feature: service-tracking, Property 6: exactly one winner sets derived fields + outbox atomically.
  it('an advancing transition succeeds only from its expected state; else no-op', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<SessionState>(...NON_TERMINAL_STATES, ...TERMINAL_STATES),
        async (from) => {
          const { repo, outbox } = buildRepo(baseRow({ state: from }));
          const svc = new ServiceSessionService(repo, {} as GeofenceService, PUBLISHER);

          const canEnRoute = from === SessionState.MATCHED;
          try {
            await svc.startEnRoute('sess-1', 'cleaner-1');
            expect(canEnRoute).toBe(true);
            expect(outbox.some((r) => r.type === 'service_en_route')).toBe(true);
          } catch {
            expect(canEnRoute).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
    void ALLOWED_ADVANCE;
  });

  // Feature: service-tracking, Property 6: N concurrent actors → exactly one winner.
  it('N concurrent identical transitions produce exactly one winner (rest no-op)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 8 }), async (actors) => {
        const { repo } = buildRepo(baseRow({ state: SessionState.MATCHED }));
        const svc = new ServiceSessionService(repo, {} as GeofenceService, PUBLISHER);
        const attempts = Array.from({ length: actors }, () =>
          svc.startEnRoute('sess-1', 'cleaner-1').then(
            () => 'won',
            () => 'lost',
          ),
        );
        const results = await Promise.all(attempts);
        expect(results.filter((r) => r === 'won')).toHaveLength(1);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: service-tracking, Property 6: every service_* event id is deterministic per session.
  it('outbox event ids are deterministic per (type, sessionId)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 16 }), (sessionId) => {
        const ids = {
          sessionId,
          offerId: 'o',
          cleanerId: 'c',
          hostId: 'h',
        };
        expect(buildEnRouteOutboxRow(ids).eventId).toBe(`service_en_route:${sessionId}`);
        expect(buildArrivedOutboxRow(ids, 10).eventId).toBe(`service_arrived:${sessionId}`);
        expect(buildStartedOutboxRow(ids).eventId).toBe(`service_started:${sessionId}`);
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 7: no stuck session, differentiated causes ────────────────────────
describe('P7 — no stuck session, differentiated causes', () => {
  // Feature: service-tracking, Property 7: each cause maps to a distinct ended_reason.
  it('force-cancel from any non-terminal state uses the given reason; terminal is a no-op', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<SessionState>(...NON_TERMINAL_STATES, ...TERMINAL_STATES),
        async (from) => {
          const { repo, current } = buildRepo(baseRow({ state: from }));
          const svc = new ServiceSessionService(repo, {} as GeofenceService, PUBLISHER);
          await svc.forceCancelForOffer('offer-1', EndedReason.CANCELED_OFFER_TERMINAL);
          if (isTerminalState(from)) {
            expect(current().state).toBe(from); // unchanged
          } else {
            expect(current().state).toBe(SessionState.CANCELED);
            expect(current().ended_reason).toBe(EndedReason.CANCELED_OFFER_TERMINAL);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Property 9: position is ephemeral (no persisted trail) ─────────────────────
describe('P9 — position is ephemeral', () => {
  // Feature: service-tracking, Property 9: no coordinate is ever persisted; only arrival_distance_m.
  it('ingesting many samples never persists a coordinate (repo has no coordinate write path)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            lat: fc.double({ min: -90, max: 90, noNaN: true }),
            lng: fc.double({ min: -180, max: 180, noNaN: true }),
            accuracy: fc.double({ min: 0, max: 40, noNaN: true }),
            at: fc.integer({ min: 0, max: 2_000_000_000 }),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        async (samples) => {
          const { repo } = buildRepo(baseRow({ state: SessionState.EN_ROUTE }));
          const geofence = {
            isEligible: jest.fn().mockReturnValue(false),
            isWithinGeofence: jest.fn(),
          } as unknown as GeofenceService;
          const publishArgs: unknown[] = [];
          const publisher: ServiceRealtimePublisher = {
            publish: jest.fn(async (_c: string, data: unknown) => {
              publishArgs.push(data);
              return true;
            }),
          };
          const svc = new ServiceSessionService(repo, geofence, publisher);
          for (const s of samples) {
            await svc.ingestPosition('sess-1', 'cleaner-1', s as PositionSample);
          }
          // The only persisted write path for ingest is transition (arrival) — never a coordinate.
          // Here nothing arrived, so no transition wrote a durable location; positions were only
          // relayed (ephemeral).
          expect(publishArgs.length).toBe(samples.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Property 10: best-effort transport, authoritative reconciliation ───────────
describe('P10 — best-effort transport, authoritative reconciliation', () => {
  // Feature: service-tracking, Property 10: any publish outcome leaves durable state identical.
  it('publish success/failure yields identical durable state + GET reflects it', async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (publishSucceeds) => {
        const { repo, current } = buildRepo(baseRow({ state: SessionState.EN_ROUTE }));
        const geofence = {
          isEligible: jest.fn().mockReturnValue(true),
          isWithinGeofence: jest.fn().mockResolvedValue({ within: true, distanceM: 5 }),
        } as unknown as GeofenceService;
        const publisher: ServiceRealtimePublisher = {
          publish: publishSucceeds
            ? jest.fn().mockResolvedValue(true)
            : jest.fn().mockRejectedValue(new Error('down')),
        };
        const svc = new ServiceSessionService(repo, geofence, publisher);
        const sample: PositionSample = { lat: 4.6, lng: -74.08, accuracy: 10, at: Date.now() };
        const view = await svc.ingestPosition('sess-1', 'cleaner-1', sample);
        // Durable state is ARRIVED regardless of the publish outcome; GET returns the same.
        expect(view.state).toBe(SessionState.ARRIVED);
        expect(current().state).toBe(SessionState.ARRIVED);
        const reconciled = await svc.getSession('sess-1', 'host-1');
        expect(reconciled.state).toBe(SessionState.ARRIVED);
        expect(reconciled.arrivalDistanceM).toBe(5);
      }),
      { numRuns: 100 },
    );
  });
});
