import * as fc from 'fast-check';
import { ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { NotificationDeviceController } from '../notification-device.controller';
import { DeviceRegistryService } from '../device-registry.service';
import { User } from '../../auth/entities/user.entity';
import { JwtUserPayload } from '../../auth/guards/jwt.types';
import { RegisterDeviceDto } from '../dto/register-device.dto';

/**
 * Property-based test (fast-check, >=100 iters) for registry authorization.
 *
 * Feature: push-notifications, Property 7: Registry authorization
 * Validates: Requirements 1.4
 *
 * A device register whose body `userId` differs from the JWT subject is rejected with 403 and
 * mutates nothing; a matching or absent `userId` is accepted.
 */

function makeController(subjectUserId: string) {
  const registry = {
    registerDevice: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<DeviceRegistryService>;
  const userRepo = {
    findOne: jest.fn().mockResolvedValue({ id: subjectUserId, keycloakId: 'kc-1' } as User),
  } as unknown as jest.Mocked<Repository<User>>;
  const controller = new NotificationDeviceController(registry, userRepo);
  return { controller, registry };
}

const req = { user: { keycloakId: 'kc-1' } as JwtUserPayload } as Request & { user: JwtUserPayload };

describe('NotificationDeviceController — Property 7 (authorization)', () => {
  it('Property 7: register for a non-subject userId -> 403 and mutates nothing', async () => {
    // Feature: push-notifications, Property 7: Registry authorization
    await fc.assert(
      fc.asyncProperty(fc.uuid(), fc.uuid(), async (subjectId, otherId) => {
        fc.pre(subjectId !== otherId);
        const { controller, registry } = makeController(subjectId);
        const dto: RegisterDeviceDto = {
          onesignalPlayerId: 'p1',
          platform: 'IOS',
          consentGranted: true,
          userId: otherId,
        };
        await expect(controller.register(req, dto)).rejects.toBeInstanceOf(ForbiddenException);
        expect(registry.registerDevice).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });

  it('Property 7: register with matching or absent userId is accepted', async () => {
    // Feature: push-notifications, Property 7: Registry authorization
    await fc.assert(
      fc.asyncProperty(fc.uuid(), fc.boolean(), async (subjectId, includeUserId) => {
        const { controller, registry } = makeController(subjectId);
        const dto: RegisterDeviceDto = {
          onesignalPlayerId: 'p1',
          platform: 'ANDROID',
          consentGranted: true,
          ...(includeUserId ? { userId: subjectId } : {}),
        };
        await expect(controller.register(req, dto)).resolves.toBeUndefined();
        expect(registry.registerDevice).toHaveBeenCalledTimes(1);
      }),
      { numRuns: 100 },
    );
  });
});
