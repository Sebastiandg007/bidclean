import { Job } from 'bullmq';
import { NotificationType } from '../notifications.types';
import { DeliveryWorker, DeliveryJobData } from '../delivery.worker';
import { NotificationsRepository } from '../notifications.repository';
import { DeviceRegistryService } from '../device-registry.service';
import { NotificationContentCatalog } from '../notification-content.catalog';
import { OneSignalClient } from '../onesignal/onesignal.client';
import { Notification } from '../entities/notification.entity';

/**
 * Unit tests for DeliveryWorker (Task 9.4).
 * Feature: push-notifications — P12 (single-winner), P13 (best-effort graceful failure).
 */
describe('DeliveryWorker', () => {
  const ledger: Notification = {
    id: 'ledger-1',
    recipientUserId: 'user-1',
    type: NotificationType.OFFER_MATCHED,
    category: 'offers',
    channel: 'PUSH',
    dedupKey: 'evt-1:v1:user-1',
    deepLink: { type: 'offer_matched', offerId: 'offer-1' },
    payloadRef: { offerId: 'offer-1' },
    priority: 'HIGH',
    status: 'PROCESSING',
    suppressionReason: null,
    attempt: 1,
    sentAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function build(opts: {
    won?: boolean;
    playerIds?: string[];
    sendResult?: { ok: boolean; invalidPlayerIds: string[] };
  }) {
    const repo = {
      claimForDelivery: jest.fn().mockResolvedValue(opts.won ?? true),
      findLedger: jest.fn().mockResolvedValue(ledger),
      markSent: jest.fn().mockResolvedValue(undefined),
      markStatus: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<NotificationsRepository>;
    const registry = {
      resolveConsentedPlayerIds: jest.fn().mockResolvedValue(opts.playerIds ?? ['p1', 'p2']),
      markStale: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<DeviceRegistryService>;
    const catalog = new NotificationContentCatalog();
    const oneSignal = {
      send: jest.fn().mockResolvedValue(opts.sendResult ?? { ok: true, invalidPlayerIds: [] }),
    } as unknown as jest.Mocked<OneSignalClient>;
    const worker = new DeliveryWorker(repo, registry, catalog, oneSignal);
    return { worker, repo, registry, oneSignal };
  }

  const job = (attemptsMade = 0): Job<DeliveryJobData> =>
    ({ data: { ledgerId: 'ledger-1' }, attemptsMade } as Job<DeliveryJobData>);

  it('P12: a losing worker (claim=false) no-ops without sending', async () => {
    const { worker, oneSignal } = build({ won: false });
    await worker.process(job());
    expect(oneSignal.send).not.toHaveBeenCalled();
  });

  it('sends per consented player id (Model B) and marks SENT', async () => {
    const { worker, repo, oneSignal } = build({ playerIds: ['p1', 'p2'] });
    await worker.process(job());
    expect(oneSignal.send).toHaveBeenCalledWith(
      expect.objectContaining({ playerIds: ['p1', 'p2'], idempotencyKey: 'evt-1:v1:user-1' }),
    );
    expect(repo.markSent).toHaveBeenCalledWith('ledger-1');
  });

  it('no consented device -> SUPPRESSED(no-device), no OneSignal call', async () => {
    const { worker, repo, oneSignal } = build({ playerIds: [] });
    await worker.process(job());
    expect(oneSignal.send).not.toHaveBeenCalled();
    expect(repo.markStatus).toHaveBeenCalledWith('ledger-1', 'SUPPRESSED', 'no-device');
  });

  it('P13: an invalid player id is marked stale', async () => {
    const { worker, registry } = build({ sendResult: { ok: true, invalidPlayerIds: ['p2'] } });
    await worker.process(job());
    expect(registry.markStale).toHaveBeenCalledWith('p2');
  });

  it('P13: a transport failure with attempts remaining marks FAILED_RETRYABLE and rethrows', async () => {
    const { worker, repo } = build({ sendResult: { ok: false, invalidPlayerIds: [] } });
    await expect(worker.process(job(0))).rejects.toThrow(/scheduling retry/);
    expect(repo.markStatus).toHaveBeenCalledWith('ledger-1', 'FAILED_RETRYABLE');
  });

  it('P13: a transport failure with attempts exhausted marks FAILED_FINAL and swallows', async () => {
    const { worker, repo } = build({ sendResult: { ok: false, invalidPlayerIds: [] } });
    // Max attempts default is 5; attemptsMade=4 -> attemptsMade+1=5 == max -> final.
    await expect(worker.process(job(4))).resolves.toBeUndefined();
    expect(repo.markStatus).toHaveBeenCalledWith('ledger-1', 'FAILED_FINAL');
  });
});
