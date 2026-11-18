import { Repository } from 'typeorm';
import { Request } from 'express';
import { NotificationDeviceController } from '../notification-device.controller';
import { NotificationPreferenceController } from '../notification-preference.controller';
import { DeviceRegistryService } from '../device-registry.service';
import { NotificationsRepository } from '../notifications.repository';
import { User } from '../../auth/entities/user.entity';
import { JwtUserPayload } from '../../auth/guards/jwt.types';

/**
 * Unit tests for the device + preference controllers (Task 11.4).
 * Feature: push-notifications — self-scoped registry/preferences (supports P7).
 */
const req = { user: { keycloakId: 'kc-1' } as JwtUserPayload } as Request & { user: JwtUserPayload };
const user = { id: 'user-1', keycloakId: 'kc-1' } as User;

describe('NotificationDeviceController', () => {
  function build() {
    const registry = {
      registerDevice: jest.fn().mockResolvedValue(undefined),
      updateConsent: jest.fn().mockResolvedValue(undefined),
      unregisterDevice: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<DeviceRegistryService>;
    const userRepo = { findOne: jest.fn().mockResolvedValue(user) } as unknown as jest.Mocked<Repository<User>>;
    return { controller: new NotificationDeviceController(registry, userRepo), registry };
  }

  it('registers a device for the caller', async () => {
    const { controller, registry } = build();
    await controller.register(req, { onesignalPlayerId: 'p1', platform: 'IOS', consentGranted: true });
    expect(registry.registerDevice).toHaveBeenCalledWith(user, 'p1', 'IOS', true);
  });

  it('updates the caller device consent', async () => {
    const { controller, registry } = build();
    await controller.updateConsent(req, 'p1', { consentGranted: false });
    expect(registry.updateConsent).toHaveBeenCalledWith(user, 'p1', false);
  });

  it('unregisters the caller device', async () => {
    const { controller, registry } = build();
    await controller.unregister(req, 'p1');
    expect(registry.unregisterDevice).toHaveBeenCalledWith('user-1', 'p1');
  });
});

describe('NotificationPreferenceController', () => {
  function build(prefs: unknown = null) {
    const repo = {
      findPreferences: jest.fn().mockResolvedValue(prefs),
      upsertPreferences: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<NotificationsRepository>;
    const userRepo = { findOne: jest.fn().mockResolvedValue(user) } as unknown as jest.Mocked<Repository<User>>;
    return { controller: new NotificationPreferenceController(repo, userRepo), repo };
  }

  it('returns defaults when no preferences exist', async () => {
    const { controller } = build(null);
    const view = await controller.get(req);
    expect(view).toEqual({
      categoryOptOut: {},
      quietHoursStart: null,
      quietHoursEnd: null,
      quietHoursTimezone: null,
      language: null,
    });
  });

  it('upserts preferences self-scoped', async () => {
    const { controller, repo } = build();
    await controller.update(req, { categoryOptOut: { offers: false }, language: 'es' });
    expect(repo.upsertPreferences).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ categoryOptOut: { offers: false }, language: 'es' }),
    );
  });
});
