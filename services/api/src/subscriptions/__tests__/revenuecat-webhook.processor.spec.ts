import type { Job } from 'bullmq';
import { RevenueCatWebhookProcessor } from '../webhooks/revenuecat-webhook.processor';
import { SubscriptionsRepository } from '../subscriptions.repository';
import { SubscriptionEvent } from '../entities/subscription-event.entity';
import { DispatchStatus, EntitlementDelta } from '../subscriptions.types';

/**
 * Unit tests for RevenueCatWebhookProcessor.
 *
 * Feature: revenuecat-subscriptions
 * Validates: Requirements 2.6, 2.8, 2.10, P16 (applies deltas + PROCESSED; idempotent on
 * already-PROCESSED; unknown event -> no mutation but still PROCESSED; FAILED on exhaustion).
 */

interface FakeRepo {
  findLedgerRow: jest.Mock;
  applyDeltas: jest.Mock;
  markFailed: jest.Mock;
}

function buildProcessor(overrides: Partial<FakeRepo> = {}): {
  processor: RevenueCatWebhookProcessor;
  mocks: FakeRepo;
} {
  const mocks: FakeRepo = {
    findLedgerRow: jest.fn(),
    applyDeltas: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { processor: new RevenueCatWebhookProcessor(mocks as unknown as SubscriptionsRepository), mocks };
}

function ledgerRow(overrides: Partial<SubscriptionEvent> = {}): SubscriptionEvent {
  return {
    id: 'ledger-1',
    dispatchStatus: DispatchStatus.RECEIVED,
    payloadJson: {
      eventId: 'evt_1',
      type: 'INITIAL_PURCHASE',
      appUserId: 'user-1',
      entitlementIds: ['cleaner_pro'],
      store: 'app_store',
      eventTimestampMs: 1_700_000_000_000,
      expirationAtMs: 1_700_100_000_000,
    },
    ...overrides,
  } as unknown as SubscriptionEvent;
}

function job(data: { ledgerId: string; revenuecatEventId: string }, opts?: { attempts?: number; attemptsMade?: number }): Job<{ ledgerId: string; revenuecatEventId: string }> {
  return {
    data,
    attemptsMade: opts?.attemptsMade ?? 0,
    opts: { attempts: opts?.attempts ?? 1 },
  } as unknown as Job<{ ledgerId: string; revenuecatEventId: string }>;
}

describe('RevenueCatWebhookProcessor', () => {
  it('maps the payload to deltas and applies them with the ledger id', async () => {
    const { processor, mocks } = buildProcessor({ findLedgerRow: jest.fn().mockResolvedValue(ledgerRow()) });

    await processor.process(job({ ledgerId: 'ledger-1', revenuecatEventId: 'evt_1' }));

    expect(mocks.applyDeltas).toHaveBeenCalledTimes(1);
    const [deltas, ledgerId] = mocks.applyDeltas.mock.calls[0] as [EntitlementDelta[], string];
    expect(ledgerId).toBe('ledger-1');
    expect(deltas[0]).toMatchObject({ entitlementKey: 'CLEANER_PRO', active: true });
  });

  it('is a no-op when the ledger row is already PROCESSED (idempotent)', async () => {
    const { processor, mocks } = buildProcessor({
      findLedgerRow: jest.fn().mockResolvedValue(ledgerRow({ dispatchStatus: DispatchStatus.PROCESSED })),
    });

    await processor.process(job({ ledgerId: 'ledger-1', revenuecatEventId: 'evt_1' }));

    expect(mocks.applyDeltas).not.toHaveBeenCalled();
  });

  it('still marks PROCESSED (empty deltas) for an unknown event type', async () => {
    const unknown = ledgerRow({
      payloadJson: { eventId: 'evt_x', type: 'FUTURE_EVENT', entitlementIds: ['cleaner_pro'] } as never,
    });
    const { processor, mocks } = buildProcessor({ findLedgerRow: jest.fn().mockResolvedValue(unknown) });

    await processor.process(job({ ledgerId: 'ledger-1', revenuecatEventId: 'evt_x' }));

    const [deltas] = mocks.applyDeltas.mock.calls[0] as [EntitlementDelta[], string];
    expect(deltas).toEqual([]); // no mutation, but ledger is still marked PROCESSED by applyDeltas
  });

  it('skips gracefully when the ledger row is missing', async () => {
    const { processor, mocks } = buildProcessor({ findLedgerRow: jest.fn().mockResolvedValue(null) });
    await processor.process(job({ ledgerId: 'gone', revenuecatEventId: 'evt_1' }));
    expect(mocks.applyDeltas).not.toHaveBeenCalled();
  });

  it('marks FAILED when retries are exhausted', async () => {
    const { processor, mocks } = buildProcessor();
    await processor.onFailed(job({ ledgerId: 'ledger-1', revenuecatEventId: 'evt_1' }, { attempts: 3, attemptsMade: 3 }));
    expect(mocks.markFailed).toHaveBeenCalledWith('ledger-1');
  });

  it('does not mark FAILED while retries remain', async () => {
    const { processor, mocks } = buildProcessor();
    await processor.onFailed(job({ ledgerId: 'ledger-1', revenuecatEventId: 'evt_1' }, { attempts: 3, attemptsMade: 1 }));
    expect(mocks.markFailed).not.toHaveBeenCalled();
  });
});
