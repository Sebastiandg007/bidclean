import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { RevenueCatWebhookController } from '../webhooks/revenuecat-webhook.controller';
import { SubscriptionsRepository } from '../subscriptions.repository';
import { computeSignature } from '../revenuecat/revenuecat-signature';
import { REVENUECAT_WEBHOOK_SIGNING_SECRET } from '../subscriptions.constants';

/**
 * Unit tests for RevenueCatWebhookController.
 *
 * Feature: revenuecat-subscriptions
 * Validates: Requirements 2.1, 2.2, 2.3, 2.5 (public HMAC endpoint; 401 no mutation; dedup ack;
 * ledger RECEIVED before ack + enqueue+markQueued; recoverable on enqueue failure).
 *
 * The signing secret is seeded by test/setup-env.ts.
 */

interface FakeRepo {
  hasProcessedEvent: jest.Mock;
  appendEvent: jest.Mock;
  markQueued: jest.Mock;
}

function buildRepo(overrides: Partial<FakeRepo> = {}): { repo: SubscriptionsRepository; mocks: FakeRepo } {
  const mocks: FakeRepo = {
    hasProcessedEvent: jest.fn().mockResolvedValue(false),
    appendEvent: jest.fn().mockResolvedValue('ledger-1'),
    markQueued: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { repo: mocks as unknown as SubscriptionsRepository, mocks };
}

function buildQueue(add: jest.Mock): Queue {
  return { add } as unknown as Queue;
}

function rawRequest(body: string): { rawBody: Buffer } {
  return { rawBody: Buffer.from(body, 'utf8') };
}

const EVENT_BODY = JSON.stringify({
  event: {
    id: 'evt_1',
    type: 'INITIAL_PURCHASE',
    app_user_id: 'user-1',
    entitlement_ids: ['cleaner_pro'],
    store: 'app_store',
    event_timestamp_ms: 1_700_000_000_000,
    expiration_at_ms: 1_700_100_000_000,
  },
});

function signedHeaders(body: string): { signature: string; timestamp: string } {
  const timestamp = String(Date.now());
  return { signature: computeSignature(body, timestamp, REVENUECAT_WEBHOOK_SIGNING_SECRET), timestamp };
}

describe('RevenueCatWebhookController', () => {
  it('rejects an invalid signature with 401 and does not mutate', async () => {
    const { repo, mocks } = buildRepo();
    const add = jest.fn();
    const controller = new RevenueCatWebhookController(repo, buildQueue(add));

    await expect(
      controller.handle(rawRequest(EVENT_BODY) as never, 'bad-signature', String(Date.now()), undefined),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(mocks.appendEvent).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('acknowledges a duplicate event without appending or enqueueing', async () => {
    const { repo, mocks } = buildRepo({ hasProcessedEvent: jest.fn().mockResolvedValue(true) });
    const add = jest.fn();
    const controller = new RevenueCatWebhookController(repo, buildQueue(add));
    const { signature, timestamp } = signedHeaders(EVENT_BODY);

    const result = await controller.handle(rawRequest(EVENT_BODY) as never, signature, timestamp, undefined);

    expect(result).toEqual({ received: true });
    expect(mocks.appendEvent).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('appends RECEIVED, enqueues, and marks QUEUED on a valid new event', async () => {
    const { repo, mocks } = buildRepo();
    const add = jest.fn().mockResolvedValue(undefined);
    const controller = new RevenueCatWebhookController(repo, buildQueue(add));
    const { signature, timestamp } = signedHeaders(EVENT_BODY);

    const result = await controller.handle(rawRequest(EVENT_BODY) as never, signature, timestamp, undefined);

    expect(result).toEqual({ received: true });
    expect(mocks.appendEvent).toHaveBeenCalledTimes(1);
    // Ledger append happens before enqueue (RECEIVED committed before ACK).
    const appendOrder = mocks.appendEvent.mock.invocationCallOrder[0] ?? 0;
    const addOrder = add.mock.invocationCallOrder[0] ?? 0;
    expect(appendOrder).toBeLessThan(addOrder);
    expect(add).toHaveBeenCalledTimes(1);
    expect(mocks.markQueued).toHaveBeenCalledWith('ledger-1');
  });

  it('still acknowledges when enqueue fails (row left RECEIVED for recovery)', async () => {
    const { repo, mocks } = buildRepo();
    const add = jest.fn().mockRejectedValue(new Error('redis down'));
    const controller = new RevenueCatWebhookController(repo, buildQueue(add));
    const { signature, timestamp } = signedHeaders(EVENT_BODY);

    const result = await controller.handle(rawRequest(EVENT_BODY) as never, signature, timestamp, undefined);

    expect(result).toEqual({ received: true });
    expect(mocks.appendEvent).toHaveBeenCalledTimes(1);
    expect(mocks.markQueued).not.toHaveBeenCalled(); // never marked QUEUED -> recoverable
  });

  it('acknowledges when a concurrent insert already recorded the event (append returns null)', async () => {
    const { repo, mocks } = buildRepo({ appendEvent: jest.fn().mockResolvedValue(null) });
    const add = jest.fn();
    const controller = new RevenueCatWebhookController(repo, buildQueue(add));
    const { signature, timestamp } = signedHeaders(EVENT_BODY);

    const result = await controller.handle(rawRequest(EVENT_BODY) as never, signature, timestamp, undefined);

    expect(result).toEqual({ received: true });
    expect(add).not.toHaveBeenCalled();
    expect(mocks.markQueued).not.toHaveBeenCalled();
  });

  it('rejects a malformed event body with 400', async () => {
    const { repo } = buildRepo();
    const controller = new RevenueCatWebhookController(repo, buildQueue(jest.fn()));
    const body = JSON.stringify({ event: { id: '', type: '' } });
    const { signature, timestamp } = signedHeaders(body);

    await expect(
      controller.handle(rawRequest(body) as never, signature, timestamp, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
