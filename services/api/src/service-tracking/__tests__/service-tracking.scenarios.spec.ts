import { Logger } from '@nestjs/common';

import { GeofenceService } from '../geofence.service';
import { ServiceSessionService, ServiceRealtimePublisher } from '../service-session.service';
import { ServiceActivationConsumer } from '../service-activation.consumer';
import { ServiceOutboxConsumerCheckpoint } from '../service-outbox-consumer.checkpoint';
import { OfferTerminalSessionListener } from '../offer-terminal-session.listener';
import { ServiceSweepProcessor } from '../service-sweep.processor';
import {
  ServiceSessionRepository,
  ServiceSessionRow,
  TransitionDerivedFields,
  UnackedOutboxRow,
  UnconsumedActivationRow,
} from '../service-session.repository';
import { ServiceOutboxConsumer } from '../service-outbox';
import { ActivationPayload, EndedReason, PositionSample, SessionState } from '../service-tracking.types';
import { OFFER_EVENT_NAMES } from '../../offers/events/offer-domain-events';
import { OutboxRow } from '../../common/outbox/outbox-writer';
import { Queue } from 'bullmq';

/**
 * Scenario / integration tests for service-tracking (Spec 17, Task 14).
 *
 * Wires the REAL services (session service, activation consumer, offer-terminal listener, sweep,
 * fan-out checkpoint) over an in-memory fake repository that upholds the DB invariants: `UNIQUE
 * offer_id` (ON CONFLICT no-op), the single-winner conditional write, the `service_outbox` fan-out,
 * and the activation cursor. No live Postgres/PostGIS/Redis/Centrifugo — geofence + publish are
 * mocked, exactly per the spec's "zero real external calls" testing strategy.
 */

jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

interface StoredActivation {
  eventId: string;
  payload: ActivationPayload;
}

/** In-memory fake mirroring the repository's DB-level invariants. */
class FakeRepo {
  sessions = new Map<string, ServiceSessionRow>(); // by id
  private byOffer = new Map<string, string>(); // offerId → id
  activationOutbox: StoredActivation[] = [];
  activationConsumed = new Set<string>();
  outbox: Array<{ eventId: string; type: string; aggregateId: string; payload: Record<string, unknown> }> = [];
  outboxAcks = new Set<string>(); // `${eventId}::${consumer}`
  private seq = 0;
  radiusUsable = true;

  async createSession(payload: ActivationPayload, radiusM: number): Promise<ServiceSessionRow | null> {
    const existingId = this.byOffer.get(payload.offerId);
    if (existingId) {
      return this.sessions.get(existingId) ?? null; // ON CONFLICT DO NOTHING → existing
    }
    if (!this.radiusUsable) {
      return null; // no usable property snapshot
    }
    const id = `sess-${++this.seq}`;
    const row: ServiceSessionRow = {
      id,
      offer_id: payload.offerId,
      host_id: payload.hostId,
      cleaner_id: payload.cleanerId,
      property_id: payload.propertyId,
      state: SessionState.MATCHED,
      ended_reason: null,
      geofence_radius_m: radiusM,
      en_route_at: null,
      arrived_at: null,
      started_at: null,
      arrival_distance_m: null,
      last_progress_at: null,
      created_at: new Date(0),
      snapshot_lng: -74.08,
      snapshot_lat: 4.6,
    };
    this.sessions.set(id, row);
    this.byOffer.set(payload.offerId, id);
    return row;
  }

  async findById(id: string): Promise<ServiceSessionRow | null> {
    return this.sessions.get(id) ?? null;
  }

  async findByOfferId(offerId: string): Promise<ServiceSessionRow | null> {
    const id = this.byOffer.get(offerId);
    return id ? this.sessions.get(id) ?? null : null;
  }

  async touchProgress(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (s && s.state === SessionState.EN_ROUTE) {
      this.sessions.set(id, { ...s, last_progress_at: new Date() });
    }
  }

  async resolvePropertyChecklistItems(_propertyId: string): Promise<string[]> {
    void _propertyId;
    return [];
  }

  async transition(
    id: string,
    expected: SessionState,
    next: SessionState,
    derived: TransitionDerivedFields,
    outbox: OutboxRow | null,
  ): Promise<ServiceSessionRow | null> {
    const s = this.sessions.get(id);
    if (!s || s.state !== expected) {
      return null; // single-winner guard
    }
    const updated: ServiceSessionRow = {
      ...s,
      state: next,
      ended_reason: derived.endedReason ?? s.ended_reason,
      arrival_distance_m: derived.arrivalDistanceM ?? s.arrival_distance_m,
      arrived_at: derived.arrivedAt ? new Date(9) : s.arrived_at,
      en_route_at: derived.enRouteAt ? new Date(1) : s.en_route_at,
      started_at: derived.startedAt ? new Date(2) : s.started_at,
    };
    this.sessions.set(id, updated);
    if (outbox) {
      // UNIQUE event_id — same-tx write; a duplicate id is a no-op (idempotent).
      if (!this.outbox.some((o) => o.eventId === outbox.eventId)) {
        this.outbox.push({
          eventId: outbox.eventId,
          type: outbox.type,
          aggregateId: outbox.aggregateId,
          payload: outbox.payload as Record<string, unknown>,
        });
      }
    }
    return updated;
  }

  async findActivationUnconsumed(limit: number): Promise<UnconsumedActivationRow[]> {
    return this.activationOutbox
      .filter((a) => !this.activationConsumed.has(a.eventId))
      .slice(0, limit)
      .map((a) => ({ eventId: a.eventId, payload: a.payload }));
  }

  async markActivationConsumed(eventId: string): Promise<void> {
    this.activationConsumed.add(eventId);
  }

  async findOutboxUnackedFor(consumer: string, limit: number): Promise<UnackedOutboxRow[]> {
    return this.outbox
      .filter((o) => !this.outboxAcks.has(`${o.eventId}::${consumer}`))
      .slice(0, limit)
      .map((o) => ({ eventId: o.eventId, type: o.type, aggregateId: o.aggregateId, payload: o.payload }));
  }

  async ackOutboxFor(eventId: string, consumer: string): Promise<void> {
    this.outboxAcks.add(`${eventId}::${consumer}`);
  }

  async findAbandonedMatched(_before: Date, limit: number): Promise<string[]> {
    return [...this.sessions.values()]
      .filter((s) => s.state === SessionState.MATCHED)
      .slice(0, limit)
      .map((s) => s.id);
  }

  async findExpirableEnRoute(_before: Date, limit: number): Promise<string[]> {
    return [...this.sessions.values()]
      .filter((s) => s.state === SessionState.EN_ROUTE)
      .slice(0, limit)
      .map((s) => s.id);
  }
}

function activation(offerId: string): ActivationPayload {
  return { offerId, hostId: 'host-1', cleanerId: 'cleaner-1', propertyId: 'prop-1' };
}

function buildStack(repo: FakeRepo, arrivalWithin = true): {
  service: ServiceSessionService;
  consumer: ServiceActivationConsumer;
  listener: OfferTerminalSessionListener;
  sweep: ServiceSweepProcessor;
  checkpoint: ServiceOutboxConsumerCheckpoint;
  publish: jest.Mock;
} {
  const repoTyped = repo as unknown as ServiceSessionRepository;
  const geofence = {
    isEligible: jest.fn().mockReturnValue(true),
    isWithinGeofence: jest.fn().mockResolvedValue({ within: arrivalWithin, distanceM: 12 }),
  } as unknown as GeofenceService;
  const publish = jest.fn().mockResolvedValue(true);
  const publisher: ServiceRealtimePublisher = { publish };
  const service = new ServiceSessionService(repoTyped, geofence, publisher);
  const consumer = new ServiceActivationConsumer(repoTyped, service);
  const listener = new OfferTerminalSessionListener(service);
  const queue = { add: jest.fn() } as unknown as Queue;
  const sweep = new ServiceSweepProcessor(queue, repoTyped, publisher);
  const checkpoint = new ServiceOutboxConsumerCheckpoint(repoTyped);
  return { service, consumer, listener, sweep, checkpoint, publish };
}

const SAMPLE: PositionSample = { lat: 4.6, lng: -74.08, accuracy: 10, at: Date.now() };

describe('Scenario: activation → session creation', () => {
  it('creates exactly one MATCHED session; redelivery does not create a second', async () => {
    const repo = new FakeRepo();
    repo.activationOutbox.push({ eventId: 'service_activation_ready:o1', payload: activation('o1') });
    const { consumer } = buildStack(repo);

    await consumer.drainOnce();
    await consumer.drainOnce(); // redelivery (already acked → no-op)
    // Simulate a second delivery of the same event id before ack cleared: still one session.
    repo.activationConsumed.clear();
    await consumer.drainOnce();

    expect(repo.sessions.size).toBe(1);
    const session = await repo.findByOfferId('o1');
    expect(session?.state).toBe(SessionState.MATCHED);
  });

  it('a create-path failure leaves the activation row re-drainable (no ack)', async () => {
    const repo = new FakeRepo();
    repo.radiusUsable = true;
    repo.activationOutbox.push({ eventId: 'service_activation_ready:o1', payload: activation('o1') });
    const { consumer, service } = buildStack(repo);
    jest.spyOn(service, 'createFromActivation').mockRejectedValueOnce(new Error('db blip'));

    await consumer.drainOnce();
    expect(repo.activationConsumed.has('service_activation_ready:o1')).toBe(false);
  });
});

describe('Scenario: full flow en-route → arrived → started', () => {
  it('advances MATCHED → EN_ROUTE → ARRIVED → IN_PROGRESS with the right outbox events', async () => {
    const repo = new FakeRepo();
    repo.activationOutbox.push({ eventId: 'service_activation_ready:o1', payload: activation('o1') });
    const { service, consumer } = buildStack(repo);
    await consumer.drainOnce();
    const session = (await repo.findByOfferId('o1'))!;

    await service.startEnRoute(session.id, 'cleaner-1');
    const arrived = await service.ingestPosition(session.id, 'cleaner-1', SAMPLE);
    expect(arrived.state).toBe(SessionState.ARRIVED);
    expect(arrived.arrivalDistanceM).toBe(12);
    const started = await service.start(session.id, 'cleaner-1');
    expect(started.state).toBe(SessionState.IN_PROGRESS);

    const types = repo.outbox.map((o) => o.type);
    expect(types).toEqual(['service_en_route', 'service_arrived', 'service_started']);
  });

  it('an out-of-radius sample stays EN_ROUTE with no arrival fact', async () => {
    const repo = new FakeRepo();
    repo.activationOutbox.push({ eventId: 'service_activation_ready:o1', payload: activation('o1') });
    const { service, consumer } = buildStack(repo, false);
    await consumer.drainOnce();
    const session = (await repo.findByOfferId('o1'))!;
    await service.startEnRoute(session.id, 'cleaner-1');
    const view = await service.ingestPosition(session.id, 'cleaner-1', SAMPLE);
    expect(view.state).toBe(SessionState.EN_ROUTE);
    expect(view.arrivalDistanceM).toBeNull();
  });
});

describe('Scenario: outbox fan-out to independent consumers', () => {
  it('notifications acks then video still receives service_arrived (and vice versa)', async () => {
    const repo = new FakeRepo();
    repo.activationOutbox.push({ eventId: 'service_activation_ready:o1', payload: activation('o1') });
    const { service, consumer, checkpoint } = buildStack(repo);
    await consumer.drainOnce();
    const session = (await repo.findByOfferId('o1'))!;
    await service.startEnRoute(session.id, 'cleaner-1');
    await service.ingestPosition(session.id, 'cleaner-1', SAMPLE); // → service_arrived

    const notif = await checkpoint.drainUnacked(ServiceOutboxConsumer.NOTIFICATIONS, 10);
    expect(notif.some((e) => e.type === 'service_arrived')).toBe(true);
    await checkpoint.ack('service_arrived:' + session.id, ServiceOutboxConsumer.NOTIFICATIONS);

    // Video still receives it independently.
    const video = await checkpoint.drainUnacked(ServiceOutboxConsumer.VIDEO, 10);
    expect(video.some((e) => e.type === 'service_arrived')).toBe(true);
  });
});

describe('Scenario: lifecycle edges (offer-terminal + sweeps)', () => {
  it('offer terminal force-cancels the session (CANCELED_OFFER_TERMINAL); further tracking rejected', async () => {
    const repo = new FakeRepo();
    repo.activationOutbox.push({ eventId: 'service_activation_ready:o1', payload: activation('o1') });
    const { service, consumer, listener } = buildStack(repo);
    await consumer.drainOnce();
    const session = (await repo.findByOfferId('o1'))!;
    await service.startEnRoute(session.id, 'cleaner-1');

    await listener.handleOfferCancelled({
      type: OFFER_EVENT_NAMES.CANCELLED,
      offerId: 'o1',
      hostId: 'host-1',
      timestamp: new Date(),
      previousState: 'MATCHED' as never,
    });
    const cancelled = await repo.findById(session.id);
    expect(cancelled?.state).toBe(SessionState.CANCELED);
    expect(cancelled?.ended_reason).toBe(EndedReason.CANCELED_OFFER_TERMINAL);
    // Further tracking is rejected (illegal transition from a terminal state).
    await expect(service.start(session.id, 'cleaner-1')).rejects.toBeDefined();
  });

  it('abandon sweep expires a never-started MATCHED session with EXPIRED_NEVER_STARTED', async () => {
    const repo = new FakeRepo();
    repo.activationOutbox.push({ eventId: 'service_activation_ready:o1', payload: activation('o1') });
    const { consumer, sweep } = buildStack(repo);
    await consumer.drainOnce();
    const session = (await repo.findByOfferId('o1'))!;

    await sweep.sweepAbandoned();
    const expired = await repo.findById(session.id);
    expect(expired?.state).toBe(SessionState.EXPIRED);
    expect(expired?.ended_reason).toBe(EndedReason.EXPIRED_NEVER_STARTED);
  });

  it('stale sweep expires an EN_ROUTE session with EXPIRED_NO_PROGRESS', async () => {
    const repo = new FakeRepo();
    repo.activationOutbox.push({ eventId: 'service_activation_ready:o1', payload: activation('o1') });
    const { service, consumer, sweep } = buildStack(repo);
    await consumer.drainOnce();
    const session = (await repo.findByOfferId('o1'))!;
    await service.startEnRoute(session.id, 'cleaner-1');

    await sweep.sweepStaleEnRoute();
    const expired = await repo.findById(session.id);
    expect(expired?.state).toBe(SessionState.EXPIRED);
    expect(expired?.ended_reason).toBe(EndedReason.EXPIRED_NO_PROGRESS);
  });
});
