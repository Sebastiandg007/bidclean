import type { Queue } from 'bullmq';
import { SubscriptionDispatchWorker } from '../webhooks/subscription-dispatch.worker';
import { SubscriptionsRepository } from '../subscriptions.repository';
import { SubscriptionEvent } from '../entities/subscription-event.entity';
import { DispatchStatus } from '../subscriptions.types';

/**
 * Unit tests for SubscriptionDispatchWorker (recovery).
 *
 * Feature: revenuecat-subscriptions
 * Validates: Requirements 2.5, P16 (orphaned RECEIVED/QUEUED rows are re-enqueued so no
 * acknowledged event is lost).
 */

function orphan(id: string): SubscriptionEvent {
  return {
    id,
    revenuecatEventId: `evt-${id}`,
    dispatchStatus: DispatchStatus.RECEIVED,
  } as unknown as SubscriptionEvent;
}

describe('SubscriptionDispatchWorker', () => {
  it('re-enqueues orphaned ledger rows and marks them QUEUED', async () => {
    const findRecovered = jest.fn().mockResolvedValue([orphan('1'), orphan('2')]);
    const markQueued = jest.fn().mockResolvedValue(undefined);
    const repo = { findRecovered, markQueued } as unknown as SubscriptionsRepository;
    const add = jest.fn().mockResolvedValue(undefined);
    const worker = new SubscriptionDispatchWorker(repo, { add } as unknown as Queue);

    await worker.sweep();

    expect(add).toHaveBeenCalledTimes(2);
    expect(markQueued).toHaveBeenCalledWith('1');
    expect(markQueued).toHaveBeenCalledWith('2');
  });

  it('leaves a row for the next sweep when re-enqueue fails (no markQueued)', async () => {
    const findRecovered = jest.fn().mockResolvedValue([orphan('1')]);
    const markQueued = jest.fn();
    const repo = { findRecovered, markQueued } as unknown as SubscriptionsRepository;
    const add = jest.fn().mockRejectedValue(new Error('redis down'));
    const worker = new SubscriptionDispatchWorker(repo, { add } as unknown as Queue);

    await worker.sweep();

    expect(markQueued).not.toHaveBeenCalled();
  });

  it('does nothing when there are no orphaned rows', async () => {
    const findRecovered = jest.fn().mockResolvedValue([]);
    const add = jest.fn();
    const repo = { findRecovered, markQueued: jest.fn() } as unknown as SubscriptionsRepository;
    const worker = new SubscriptionDispatchWorker(repo, { add } as unknown as Queue);

    await worker.sweep();

    expect(add).not.toHaveBeenCalled();
  });

  it('does not throw when the sweep query fails', async () => {
    const repo = {
      findRecovered: jest.fn().mockRejectedValue(new Error('db down')),
      markQueued: jest.fn(),
    } as unknown as SubscriptionsRepository;
    const worker = new SubscriptionDispatchWorker(repo, { add: jest.fn() } as unknown as Queue);

    await expect(worker.sweep()).resolves.toBeUndefined();
  });
});
