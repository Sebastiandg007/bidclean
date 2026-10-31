import { DeviceRegistryService } from '../device-registry.service';
import { NotificationsRepository } from '../notifications.repository';
import { OneSignalClient } from '../onesignal/onesignal.client';
import { User } from '../../auth/entities/user.entity';

/**
 * Unit tests for DeviceRegistryService (Task 5.4).
 * Feature: push-notifications — supports P6 (Model B) / P17 (convergence).
 */
describe('DeviceRegistryService', () => {
  const user = {
    id: 'user-1',
    activeRole: 'cleaner',
    roles: ['cleaner'],
    country: 'CO',
    language: 'es',
    isEmailVerified: true,
  } as unknown as User;

  function makeRepo(): jest.Mocked<NotificationsRepository> {
    return {
      upsertDevice: jest.fn().mockResolvedValue(undefined),
      updateConsent: jest.fn().mockResolvedValue(undefined),
      deleteDevice: jest.fn().mockResolvedValue(undefined),
      resolveConsentedPlayerIds: jest.fn().mockResolvedValue([]),
      hasConsentedDevice: jest.fn().mockResolvedValue(false),
      markStale: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<NotificationsRepository>;
  }

  function makeOneSignal(): jest.Mocked<OneSignalClient> {
    return {
      syncDevice: jest.fn().mockResolvedValue(true),
      send: jest.fn(),
    } as unknown as jest.Mocked<OneSignalClient>;
  }

  it('registers a device and best-effort syncs external-user-id + tags to OneSignal', async () => {
    const repo = makeRepo();
    const oneSignal = makeOneSignal();
    const service = new DeviceRegistryService(repo, oneSignal);

    await service.registerDevice(user, 'player-A', 'IOS', true);

    expect(repo.upsertDevice).toHaveBeenCalledWith({
      userId: 'user-1',
      platform: 'IOS',
      onesignalPlayerId: 'player-A',
      consentGranted: true,
    });
    expect(oneSignal.syncDevice).toHaveBeenCalledWith('player-A', 'user-1', expect.any(Object));
  });

  it('updateConsent targets only the specified device (never affects others)', async () => {
    const repo = makeRepo();
    const service = new DeviceRegistryService(repo, makeOneSignal());

    await service.updateConsent(user, 'player-B', false);

    expect(repo.updateConsent).toHaveBeenCalledWith('user-1', 'player-B', false);
    expect(repo.updateConsent).toHaveBeenCalledTimes(1);
  });

  it('markStale excludes a player id from future targeting', async () => {
    const repo = makeRepo();
    const service = new DeviceRegistryService(repo, makeOneSignal());

    await service.markStale('player-stale');

    expect(repo.markStale).toHaveBeenCalledWith('player-stale');
  });

  it('applySubscriptionWebhook marks the device stale and never throws', async () => {
    const repo = makeRepo();
    repo.markStale.mockRejectedValueOnce(new Error('db down'));
    const service = new DeviceRegistryService(repo, makeOneSignal());

    await expect(
      service.applySubscriptionWebhook({ kind: 'unsubscribe', playerId: 'player-X' }),
    ).resolves.toBeUndefined();
  });

  it('a device register never throws even when OneSignal sync fails', async () => {
    const repo = makeRepo();
    const oneSignal = makeOneSignal();
    oneSignal.syncDevice.mockRejectedValueOnce(new Error('onesignal down'));
    const service = new DeviceRegistryService(repo, oneSignal);

    await expect(service.registerDevice(user, 'player-C', 'ANDROID', true)).resolves.toBeUndefined();
    expect(repo.upsertDevice).toHaveBeenCalled();
  });

  it('computeTags derives coarse segments from durable user data (no PII beyond segments)', () => {
    const service = new DeviceRegistryService(makeRepo(), makeOneSignal());
    const tags = service.computeTags(user);
    expect(tags).toMatchObject({ role: 'cleaner', country: 'CO', language: 'es', verified: 'true' });
  });
});
