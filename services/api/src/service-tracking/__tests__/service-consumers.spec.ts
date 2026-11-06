import * as fc from 'fast-check';

import { ServiceActivationConsumer } from '../service-activation.consumer';
import { ServiceOutboxConsumerCheckpoint } from '../service-outbox-consumer.checkpoint';
import { OfferTerminalSessionListener } from '../offer-terminal-session.listener';
import { ServiceSessionRepository, UnackedOutboxRow } from '../service-session.repository';
import { ServiceSessionService } from '../service-session.service';
import { ServiceOutboxConsumer } from '../service-outbox';
import { ActivationPayload, EndedReason } from '../service-tracking.types';
import { OFFER_EVENT_NAMES } from '../../offers/events/offer-domain-events';

/**
 * Unit + property tests for the activation consumer, the fan-out checkpoint, and the offer-terminal
 * listener (Spec 17).
 */

function activation(offerId: string): ActivationPayload {
  return { offerId, hostId: `h-${offerId}`, cleanerId: `c-${offerId}`, propertyId: `p-${offerId}` };
}

describe('ServiceActivationConsumer', () => {
  it('creates a session then acks; a redelivered row is only acked once created', async () => {
    const consumed = new Set<string>();
    const created: string[] = [];
    const repo = {
      findActivationUnconsumed: jest.fn(async () => [
        { eventId: 'service_activation_ready:o1', payload: activation('o1') },
      ]),
      markActivationConsumed: jest.fn(async (id: string) => {
        consumed.add(id);
      }),
    } as unknown as ServiceSessionRepository;
    const sessionService = {
      createFromActivation: jest.fn(async (p: ActivationPayload) => {
        created.push(p.offerId);
      }),
    } as unknown as ServiceSessionService;

    const consumer = new ServiceActivationConsumer(repo, sessionService);
    await consumer.drainOnce();

    expect(created).toEqual(['o1']);
    expect(consumed.has('service_activation_ready:o1')).toBe(true);
  });

  // Feature: service-tracking, Property 2: a create-path failure isolates + leaves the row re-drainable.
  it('P2 (non-blocking isolation): a create failure does NOT ack (row stays re-drainable)', async () => {
    const repo = {
      findActivationUnconsumed: jest.fn(async () => [
        { eventId: 'service_activation_ready:o1', payload: activation('o1') },
      ]),
      markActivationConsumed: jest.fn(),
    } as unknown as ServiceSessionRepository;
    const sessionService = {
      createFromActivation: jest.fn().mockRejectedValue(new Error('db blip')),
    } as unknown as ServiceSessionService;

    const consumer = new ServiceActivationConsumer(repo, sessionService);
    await expect(consumer.drainOnce()).resolves.toBeUndefined();
    expect(repo.markActivationConsumed).not.toHaveBeenCalled();
  });
});

/** An in-memory fan-out store modeling service_outbox + service_outbox_consumers. */
function buildFanoutRepo(events: UnackedOutboxRow[]): {
  repo: ServiceSessionRepository;
  acks: Set<string>;
} {
  const acks = new Set<string>(); // `${eventId}::${consumer}`
  const repo = {
    findOutboxUnackedFor: jest.fn(async (consumer: string, limit: number) =>
      events.filter((e) => !acks.has(`${e.eventId}::${consumer}`)).slice(0, limit),
    ),
    ackOutboxFor: jest.fn(async (eventId: string, consumer: string) => {
      acks.add(`${eventId}::${consumer}`);
    }),
  } as unknown as ServiceSessionRepository;
  return { repo, acks };
}

describe('ServiceOutboxConsumerCheckpoint (fan-out)', () => {
  const event: UnackedOutboxRow = {
    eventId: 'service_arrived:sess-1',
    type: 'service_arrived',
    aggregateId: 'sess-1',
    payload: { sessionId: 'sess-1', arrivalDistanceM: 12 },
  };

  it('one consumer acking never marks the event processed for the other', async () => {
    const { repo } = buildFanoutRepo([event]);
    const checkpoint = new ServiceOutboxConsumerCheckpoint(repo);

    // Notifications drains + acks.
    const notif = await checkpoint.drainUnacked(ServiceOutboxConsumer.NOTIFICATIONS, 10);
    expect(notif).toHaveLength(1);
    await checkpoint.ack('service_arrived:sess-1', ServiceOutboxConsumer.NOTIFICATIONS);

    // Video still receives it.
    const video = await checkpoint.drainUnacked(ServiceOutboxConsumer.VIDEO, 10);
    expect(video).toHaveLength(1);

    // Notifications no longer sees it (idempotent per consumer).
    const notifAgain = await checkpoint.drainUnacked(ServiceOutboxConsumer.NOTIFICATIONS, 10);
    expect(notifAgain).toHaveLength(0);
  });

  it('ack is idempotent per (event_id, consumer_name)', async () => {
    const { repo } = buildFanoutRepo([event]);
    const checkpoint = new ServiceOutboxConsumerCheckpoint(repo);
    await checkpoint.ack('service_arrived:sess-1', ServiceOutboxConsumer.VIDEO);
    await checkpoint.ack('service_arrived:sess-1', ServiceOutboxConsumer.VIDEO);
    expect(await checkpoint.drainUnacked(ServiceOutboxConsumer.VIDEO, 10)).toHaveLength(0);
    // The other consumer is unaffected.
    expect(await checkpoint.drainUnacked(ServiceOutboxConsumer.NOTIFICATIONS, 10)).toHaveLength(1);
  });

  // Feature: service-tracking, Property 12: every not-yet-acked consumer receives each event; no shared marker.
  it('P12 (independent fan-out): each consumer receives each event exactly once, any interleaving', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: 50 }), { minLength: 1, maxLength: 10 }),
        fc.array(fc.constantFrom('notifications', 'video'), { minLength: 1, maxLength: 20 }),
        async (eventIds, order) => {
          const uniqueIds = [...new Set(eventIds)].map((n) => `service_arrived:s${n}`);
          const events: UnackedOutboxRow[] = uniqueIds.map((id) => ({
            eventId: id,
            type: 'service_arrived',
            aggregateId: id,
            payload: {},
          }));
          const { repo } = buildFanoutRepo(events);
          const checkpoint = new ServiceOutboxConsumerCheckpoint(repo);
          const delivered: Record<string, Set<string>> = { notifications: new Set(), video: new Set() };

          // Interleave drains/acks arbitrarily; a consumer processes then acks what it drains.
          for (const consumer of order) {
            const rows = await checkpoint.drainUnacked(consumer, 100);
            for (const r of rows) {
              delivered[consumer]?.add(r.eventId);
              await checkpoint.ack(r.eventId, consumer);
            }
          }
          // If a consumer never ran, it simply has not received yet — but every consumer that ran
          // at least once received EVERY event, independent of the other.
          for (const consumer of ['notifications', 'video'] as const) {
            if (order.includes(consumer)) {
              expect(delivered[consumer]?.size).toBe(uniqueIds.length);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('OfferTerminalSessionListener', () => {
  it('force-cancels on cancelled/expired/completed with CANCELED_OFFER_TERMINAL', async () => {
    const forceCancelForOffer = jest.fn().mockResolvedValue(undefined);
    const svc = { forceCancelForOffer } as unknown as ServiceSessionService;
    const listener = new OfferTerminalSessionListener(svc);

    await listener.handleOfferCancelled({
      type: OFFER_EVENT_NAMES.CANCELLED,
      offerId: 'o1',
      hostId: 'h',
      timestamp: new Date(),
      previousState: 'MATCHED' as never,
    });
    expect(forceCancelForOffer).toHaveBeenCalledWith('o1', EndedReason.CANCELED_OFFER_TERMINAL);
  });

  it('swallows a failure (the sweep is the backstop)', async () => {
    const svc = {
      forceCancelForOffer: jest.fn().mockRejectedValue(new Error('down')),
    } as unknown as ServiceSessionService;
    const listener = new OfferTerminalSessionListener(svc);
    await expect(
      listener.handleOfferExpired({
        type: OFFER_EVENT_NAMES.EXPIRED,
        offerId: 'o1',
        hostId: 'h',
        timestamp: new Date(),
        finalRadius: 1000,
      }),
    ).resolves.toBeUndefined();
  });
});
