import { NotificationCategory, NotificationIntent, NotificationType } from '../notifications.types';
import { Queue } from 'bullmq';
import { NotificationService } from '../notification.service';
import { NotificationsRepository, InsertLedgerParams } from '../notifications.repository';
import { NotificationTypeRegistry } from '../notification-type.registry';
import { PreferenceService } from '../preference.service';
import { Notification } from '../entities/notification.entity';

/**
 * Unit tests for NotificationService.createIntent (Task 6.5).
 * Feature: push-notifications — P4 (durable-first), P5 (no-device suppression), P3 (dedup), P11 (audit).
 */
describe('NotificationService.createIntent', () => {
  const intent: NotificationIntent = {
    recipientUserId: 'user-1',
    type: NotificationType.OFFER_MATCHED,
    category: NotificationCategory.OFFERS,
    dedupKey: 'evt-1:v1:user-1',
    deepLink: { type: 'offer_matched', offerId: 'offer-1' },
    priority: 'HIGH',
    payloadRef: { offerId: 'offer-1' },
  };

  function build(overrides: Partial<jest.Mocked<NotificationsRepository>> = {}) {
    const repo = {
      hasConsentedDevice: jest.fn().mockResolvedValue(true),
      findPreferences: jest.fn().mockResolvedValue(null),
      insertLedger: jest.fn(),
      findLedgerByDedupKey: jest.fn(),
      ...overrides,
    } as unknown as jest.Mocked<NotificationsRepository>;
    const queue = { add: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<Queue>;
    const service = new NotificationService(
      repo,
      new NotificationTypeRegistry(),
      new PreferenceService(),
      queue,
    );
    return { service, repo, queue };
  }

  it('P4: inserts a PENDING row and enqueues delivery AFTER commit (durable-first)', async () => {
    const { service, repo, queue } = build({
      insertLedger: jest.fn().mockResolvedValue('ledger-1'),
    } as never);

    const id = await service.createIntent(intent);

    expect(id).toBe('ledger-1');
    const params = (repo.insertLedger as jest.Mock).mock.calls[0][0] as InsertLedgerParams;
    expect(params.status).toBe('PENDING');
    // Enqueue happened, and only after insertLedger resolved.
    expect(queue.add).toHaveBeenCalledWith('deliver-notification', { ledgerId: 'ledger-1' });
  });

  it('P5: no consented device -> SUPPRESSED(no-device), NOT enqueued, no throw', async () => {
    const { service, repo, queue } = build({
      hasConsentedDevice: jest.fn().mockResolvedValue(false),
      insertLedger: jest.fn().mockResolvedValue('ledger-2'),
    } as never);

    await expect(service.createIntent(intent)).resolves.toBe('ledger-2');
    const params = (repo.insertLedger as jest.Mock).mock.calls[0][0] as InsertLedgerParams;
    expect(params.status).toBe('SUPPRESSED');
    expect(params.suppressionReason).toBe('no-device');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('P3: duplicate dedup_key is a no-op returning the existing id', async () => {
    const { service, queue } = build({
      insertLedger: jest.fn().mockResolvedValue(null),
      findLedgerByDedupKey: jest.fn().mockResolvedValue({ id: 'existing-1' } as Notification),
    } as never);

    const id = await service.createIntent(intent);

    expect(id).toBe('existing-1');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('P11: a suppressed intent is persisted (audit), never enqueued and never a failure', async () => {
    const { service, queue } = build({
      hasConsentedDevice: jest.fn().mockResolvedValue(false),
      insertLedger: jest.fn().mockResolvedValue('ledger-3'),
    } as never);

    await expect(service.createIntent(intent)).resolves.toBe('ledger-3');
    expect(queue.add).not.toHaveBeenCalled();
  });
});
