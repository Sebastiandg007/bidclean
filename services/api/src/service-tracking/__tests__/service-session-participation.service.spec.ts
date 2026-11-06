import * as fc from 'fast-check';

import { ServiceSessionParticipationService } from '../service-session-participation.service';
import { ServiceSessionRepository, ServiceSessionRow } from '../service-session.repository';

/**
 * Unit + property tests for ServiceSessionParticipationService (Spec 17).
 *
 * The single source of the participation rule: a user is a participant iff they are the session's
 * host or cleaner (resolved by lookup). A session id never authorizes by itself.
 */

function row(overrides: Partial<ServiceSessionRow> = {}): ServiceSessionRow {
  return {
    id: 'sess-1',
    offer_id: 'offer-1',
    host_id: 'host-1',
    cleaner_id: 'cleaner-1',
    property_id: 'prop-1',
    state: 'MATCHED',
    ended_reason: null,
    geofence_radius_m: 50,
    en_route_at: null,
    arrived_at: null,
    started_at: null,
    arrival_distance_m: null,
    last_progress_at: null,
    created_at: new Date(),
    snapshot_lng: -74.08,
    snapshot_lat: 4.6,
    ...overrides,
  };
}

function buildService(session: ServiceSessionRow | null): ServiceSessionParticipationService {
  const repo = { findById: jest.fn().mockResolvedValue(session) } as unknown as ServiceSessionRepository;
  return new ServiceSessionParticipationService(repo);
}

describe('ServiceSessionParticipationService', () => {
  it('accepts the host and the cleaner', async () => {
    const svc = buildService(row());
    expect(await svc.isParticipant('host-1', 'sess-1')).toBe(true);
    expect(await svc.isParticipant('cleaner-1', 'sess-1')).toBe(true);
  });

  it('denies a non-participant', async () => {
    const svc = buildService(row());
    expect(await svc.isParticipant('stranger', 'sess-1')).toBe(false);
  });

  it('denies when the session is unknown (learns nothing)', async () => {
    const svc = buildService(null);
    expect(await svc.isParticipant('host-1', 'sess-x')).toBe(false);
  });

  // Feature: service-tracking, Property 3: access iff user ∈ {host_id, cleaner_id}.
  it('P3 (participant isolation): participant iff user is host or cleaner', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.string({ minLength: 1, maxLength: 12 }),
        async (host, cleaner, candidate) => {
          const svc = buildService(row({ host_id: host, cleaner_id: cleaner }));
          const expected = candidate === host || candidate === cleaner;
          expect(await svc.isParticipant(candidate, 'sess-1')).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });
});
