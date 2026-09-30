import { ConflictException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';

import { GeofenceService } from '../geofence.service';
import { ServiceSessionRepository, ServiceSessionRow, TransitionDerivedFields } from '../service-session.repository';
import {
  ServiceSessionService,
  ServiceRealtimePublisher,
} from '../service-session.service';
import { EndedReason, PositionSample, SessionState } from '../service-tracking.types';
import { OutboxRow } from '../../common/outbox/outbox-writer';

/**
 * Unit tests for ServiceSessionService (Spec 17).
 *
 * A fake repository models the single-winner conditional write (a transition succeeds only when the
 * current state matches `expected`, otherwise returns null → no-op) and captures the outbox row
 * written atomically with the state change. The geofence + publisher are mocked; coordinates are
 * never asserted in logs.
 */

function row(overrides: Partial<ServiceSessionRow> = {}): ServiceSessionRow {
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

interface Captured {
  outboxRows: OutboxRow[];
  touched: number;
}

/** A fake repo whose `transition` enforces the single-winner `WHERE state=:expected` guard. */
function buildRepo(initial: ServiceSessionRow): {
  repo: ServiceSessionRepository;
  captured: Captured;
  current: () => ServiceSessionRow;
} {
  let session = initial;
  const captured: Captured = { outboxRows: [], touched: 0 };
  const repo = {
    findById: jest.fn(async (id: string) => (id === session.id ? session : null)),
    findByOfferId: jest.fn(async (offerId: string) =>
      offerId === session.offer_id ? session : null,
    ),
    touchProgress: jest.fn(async () => {
      captured.touched += 1;
    }),
    evaluateGeofence: jest.fn(),
    resolvePropertyChecklistItems: jest.fn(async () => [] as string[]),
    transition: jest.fn(
      async (
        id: string,
        expected: SessionState,
        next: SessionState,
        derived: TransitionDerivedFields,
        outbox: OutboxRow | null,
      ): Promise<ServiceSessionRow | null> => {
        if (id !== session.id || session.state !== expected) {
          return null; // lost the single-winner race / illegal edge → no-op
        }
        session = {
          ...session,
          state: next,
          ended_reason: derived.endedReason ?? session.ended_reason,
          arrival_distance_m: derived.arrivalDistanceM ?? session.arrival_distance_m,
          arrived_at: derived.arrivedAt ? new Date(123456) : session.arrived_at,
          en_route_at: derived.enRouteAt ? new Date(1) : session.en_route_at,
          started_at: derived.startedAt ? new Date(2) : session.started_at,
        };
        if (outbox) {
          captured.outboxRows.push(outbox);
        }
        return session;
      },
    ),
  } as unknown as ServiceSessionRepository;
  return { repo, captured, current: () => session };
}

function buildService(
  repo: ServiceSessionRepository,
  geofence: Partial<GeofenceService> = {},
  publisher: ServiceRealtimePublisher = { publish: jest.fn().mockResolvedValue(true) },
): ServiceSessionService {
  return new ServiceSessionService(repo, geofence as GeofenceService, publisher);
}

const SAMPLE: PositionSample = { lat: 4.6, lng: -74.08, accuracy: 10, at: Date.now() };

// Silence the expected best-effort publish-failure warnings so the suite output stays clean.
jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

describe('ServiceSessionService — authorization gates', () => {
  it('denies a non-participant on read (403) and never discloses', async () => {
    const { repo } = buildRepo(row());
    const svc = buildService(repo);
    await expect(svc.getSession('sess-1', 'stranger')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404s a missing session', async () => {
    const { repo } = buildRepo(row());
    const svc = buildService(repo);
    await expect(svc.getSession('nope', 'host-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a non-Cleaner (the Host) from en-route (403)', async () => {
    const { repo } = buildRepo(row());
    const svc = buildService(repo);
    await expect(svc.startEnRoute('sess-1', 'host-1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('ServiceSessionService — state machine', () => {
  it('MATCHED → EN_ROUTE writes en_route_at + service_en_route atomically', async () => {
    const { repo, captured } = buildRepo(row());
    const svc = buildService(repo);
    const view = await svc.startEnRoute('sess-1', 'cleaner-1');
    expect(view.state).toBe(SessionState.EN_ROUTE);
    expect(view.enRouteAt).not.toBeNull();
    expect(captured.outboxRows).toHaveLength(1);
    expect(captured.outboxRows[0]?.type).toBe('service_en_route');
    expect(captured.outboxRows[0]?.eventId).toBe('service_en_route:sess-1');
  });

  it('rejects an illegal transition (start before ARRIVED) with 409', async () => {
    const { repo } = buildRepo(row({ state: SessionState.EN_ROUTE }));
    const svc = buildService(repo);
    await expect(svc.start('sess-1', 'cleaner-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('ARRIVED → IN_PROGRESS writes started_at + service_started', async () => {
    const { repo, captured } = buildRepo(row({ state: SessionState.ARRIVED }));
    const svc = buildService(repo);
    const view = await svc.start('sess-1', 'cleaner-1');
    expect(view.state).toBe(SessionState.IN_PROGRESS);
    expect(view.startedAt).not.toBeNull();
    expect(captured.outboxRows[0]?.type).toBe('service_started');
  });

  it('cancelByParticipant on a terminal session is an idempotent no-op', async () => {
    const { repo, captured } = buildRepo(row({ state: SessionState.IN_PROGRESS }));
    const svc = buildService(repo);
    const view = await svc.cancelByParticipant('sess-1', 'host-1');
    expect(view.state).toBe(SessionState.IN_PROGRESS);
    expect(captured.outboxRows).toHaveLength(0);
  });

  it('forceCancelForOffer is idempotent (already terminal → no write)', async () => {
    const { repo } = buildRepo(row({ state: SessionState.CANCELED }));
    const svc = buildService(repo);
    await svc.forceCancelForOffer('offer-1', EndedReason.CANCELED_OFFER_TERMINAL);
    expect(repo.transition).not.toHaveBeenCalled();
  });
});

describe('ServiceSessionService — position ingress (Option A)', () => {
  it('arrives on an eligible in-radius sample: server ts + arrival_distance_m + service_arrived', async () => {
    const { repo, captured } = buildRepo(row({ state: SessionState.EN_ROUTE }));
    const svc = buildService(repo, {
      isEligible: jest.fn().mockReturnValue(true),
      isWithinGeofence: jest.fn().mockResolvedValue({ within: true, distanceM: 12 }),
    });
    const view = await svc.ingestPosition('sess-1', 'cleaner-1', SAMPLE);
    expect(view.state).toBe(SessionState.ARRIVED);
    expect(view.arrivalDistanceM).toBe(12);
    expect(view.arrivedAt).not.toBeNull();
    const arrived = captured.outboxRows.find((r) => r.type === 'service_arrived');
    expect(arrived?.payload).toMatchObject({ arrivalDistanceM: 12 });
  });

  it('an ineligible sample stays EN_ROUTE with no arrival fact (never errors)', async () => {
    const { repo, captured } = buildRepo(row({ state: SessionState.EN_ROUTE }));
    const svc = buildService(repo, {
      isEligible: jest.fn().mockReturnValue(false),
      isWithinGeofence: jest.fn(),
    });
    const view = await svc.ingestPosition('sess-1', 'cleaner-1', SAMPLE);
    expect(view.state).toBe(SessionState.EN_ROUTE);
    expect(view.arrivalDistanceM).toBeNull();
    expect(captured.outboxRows).toHaveLength(0);
  });

  it('an eligible out-of-radius sample stays EN_ROUTE but bumps progress', async () => {
    const { repo, captured } = buildRepo(row({ state: SessionState.EN_ROUTE }));
    const svc = buildService(repo, {
      isEligible: jest.fn().mockReturnValue(true),
      isWithinGeofence: jest.fn().mockResolvedValue({ within: false, distanceM: 400 }),
    });
    const view = await svc.ingestPosition('sess-1', 'cleaner-1', SAMPLE);
    expect(view.state).toBe(SessionState.EN_ROUTE);
    expect(captured.touched).toBe(1);
  });

  it('best-effort publish failure never fails ingestion (state intact)', async () => {
    const { repo } = buildRepo(row({ state: SessionState.EN_ROUTE }));
    const publisher = { publish: jest.fn().mockRejectedValue(new Error('centrifugo down')) };
    const svc = buildService(
      repo,
      { isEligible: jest.fn().mockReturnValue(false), isWithinGeofence: jest.fn() },
      publisher,
    );
    const view = await svc.ingestPosition('sess-1', 'cleaner-1', SAMPLE);
    expect(view.state).toBe(SessionState.EN_ROUTE);
    expect(publisher.publish).toHaveBeenCalled();
  });

  it('a position on a non-EN_ROUTE session is ignored for arrival but still relayed', async () => {
    const { repo, captured } = buildRepo(row({ state: SessionState.MATCHED }));
    const publisher = { publish: jest.fn().mockResolvedValue(true) };
    const svc = buildService(repo, { isEligible: jest.fn(), isWithinGeofence: jest.fn() }, publisher);
    const view = await svc.ingestPosition('sess-1', 'cleaner-1', SAMPLE);
    expect(view.state).toBe(SessionState.MATCHED);
    expect(captured.outboxRows).toHaveLength(0);
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });
});
