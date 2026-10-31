import * as fc from 'fast-check';
import { NotificationType } from '../notifications.types';
import { NotificationTypeRegistry } from '../notification-type.registry';
import { OfferOutboxMapper } from '../mappers/offer-outbox.mapper';
import { PaymentOutboxMapper } from '../mappers/payment-outbox.mapper';
import { NegotiationOutboxMapper } from '../mappers/negotiation-outbox.mapper';
import { ChatOutboxMapper } from '../mappers/chat-outbox.mapper';
import { VoipOutboxMapper } from '../mappers/voip-outbox.mapper';
import { OutboxEntityBase } from '../entities/outbox.entity';

/**
 * Property-based test (fast-check, >=100 iters) for deep-link routing.
 *
 * Feature: push-notifications, Property 14: Deep-link routing, ids only
 * Validates: Requirements 3.3, 5.2, 5.3, 6.3
 *
 * For arbitrary ids, each mapper's intent carries a typed id-based deep-link and NO forbidden
 * content fields (body/text/message/amount/token/email/name/content).
 */

const registry = new NotificationTypeRegistry();
const FORBIDDEN = ['body', 'text', 'message', 'amount', 'token', 'email', 'name', 'content'];

function row(type: string, payload: Record<string, unknown>, aggregateId: string): OutboxEntityBase {
  return {
    id: 'row-1',
    eventId: `evt-${type}-${aggregateId}`,
    aggregateType: 'agg',
    aggregateId,
    type,
    payload,
    version: 1,
    createdAt: new Date(),
    relayedAt: null,
  };
}

function assertIdsOnly(deepLink: Record<string, string>): void {
  expect(typeof deepLink.type).toBe('string');
  for (const key of Object.keys(deepLink)) {
    expect(FORBIDDEN).not.toContain(key.toLowerCase());
    expect(typeof deepLink[key]).toBe('string');
  }
}

describe('Outbox mappers — deep-link ids only', () => {
  it('Property 14: offer mapper produces an id-based deep-link with no content fields', () => {
    // Feature: push-notifications, Property 14: Deep-link routing, ids only
    const mapper = new OfferOutboxMapper(registry);
    fc.assert(
      fc.property(fc.uuid(), fc.uuid(), (recipientUserId, offerId) => {
        const intent = mapper.map(row(NotificationType.OFFER_MATCHED, { recipientUserId, offerId }, offerId));
        expect(intent).not.toBeNull();
        expect(intent!.deepLink).toEqual({ type: 'offer_matched', offerId });
        assertIdsOnly(intent!.deepLink as Record<string, string>);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 14: payment mapper deep-link carries only paymentId', () => {
    // Feature: push-notifications, Property 14: Deep-link routing, ids only
    const mapper = new PaymentOutboxMapper(registry);
    fc.assert(
      fc.property(fc.uuid(), fc.uuid(), (recipientUserId, paymentId) => {
        const intent = mapper.map(row(NotificationType.PAYMENT_RELEASED, { recipientUserId, paymentId }, paymentId));
        expect(intent!.deepLink).toEqual({ type: 'payment_released', paymentId });
        assertIdsOnly(intent!.deepLink as Record<string, string>);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 14: negotiation mapper deep-link carries only threadId', () => {
    // Feature: push-notifications, Property 14: Deep-link routing, ids only
    const mapper = new NegotiationOutboxMapper(registry);
    fc.assert(
      fc.property(fc.uuid(), fc.uuid(), (recipientUserId, threadId) => {
        const intent = mapper.map(
          row(NotificationType.NEGOTIATION_PROPOSAL_COUNTERED, { recipientUserId, threadId }, threadId),
        );
        assertIdsOnly(intent!.deepLink as Record<string, string>);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 14: chat mapper deep-link carries only conversationId (never the body)', () => {
    // Feature: push-notifications, Property 14: Deep-link routing, ids only
    const mapper = new ChatOutboxMapper(registry);
    fc.assert(
      fc.property(fc.uuid(), fc.uuid(), fc.string(), (recipientUserId, conversationId, body) => {
        // Even if the emitting domain accidentally includes a body, the mapper never surfaces it.
        const intent = mapper.map(
          row(NotificationType.MESSAGE_CREATED, { recipientUserId, conversationId, body }, conversationId),
        );
        expect(intent!.deepLink).toEqual({ type: 'new_message', conversationId });
        assertIdsOnly(intent!.deepLink as Record<string, string>);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 14: voip mapper deep-link carries callId + conversationId', () => {
    // Feature: push-notifications, Property 14: Deep-link routing, ids only
    const mapper = new VoipOutboxMapper(registry);
    fc.assert(
      fc.property(fc.uuid(), fc.uuid(), fc.uuid(), (recipientUserId, callId, conversationId) => {
        const intent = mapper.map(
          row(NotificationType.CALL_INVITED, { recipientUserId, callId, conversationId }, callId),
        );
        expect(intent!.deepLink).toEqual({ type: 'incoming_call', callId, conversationId });
        assertIdsOnly(intent!.deepLink as Record<string, string>);
      }),
      { numRuns: 100 },
    );
  });
});
