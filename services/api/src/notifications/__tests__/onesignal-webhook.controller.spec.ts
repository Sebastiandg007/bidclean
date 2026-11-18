import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { Request } from 'express';
import { OneSignalWebhookController } from '../webhooks/onesignal-webhook.controller';
import { computeOneSignalSignature } from '../webhooks/onesignal-signature';
import { ONESIGNAL_WEBHOOK_SECRET } from '../notifications.constants';
import { NotificationsRepository } from '../notifications.repository';
import { DeviceRegistryService } from '../device-registry.service';

/**
 * Unit tests for OneSignalWebhookController (Task 10.4).
 * Feature: push-notifications, Property 16: Webhook authenticity & idempotency.
 *
 * The controller reads ONESIGNAL_WEBHOOK_SECRET at import time; setup-env seeds a deterministic
 * non-secret test value, so we sign with the loaded constant and import the controller normally
 * (no isolateModules — that would create a second @nestjs/common exception identity).
 */

interface RawReq extends Request {
  rawBody?: Buffer;
}

function makeReq(rawBody: string): RawReq {
  return { rawBody: Buffer.from(rawBody, 'utf8') } as RawReq;
}

function build(recordReturns = true) {
  const repo = {
    recordWebhookEvent: jest.fn().mockResolvedValue(recordReturns),
  } as unknown as jest.Mocked<NotificationsRepository>;
  const registry = {
    applySubscriptionWebhook: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<DeviceRegistryService>;
  const controller = new OneSignalWebhookController(repo, registry);
  return { controller, repo, registry };
}

describe('OneSignalWebhookController — P16', () => {
  const body = JSON.stringify({ event_id: 'evt-1', event: 'subscription.changed', subscription_id: 'p1' });
  const validSig = (): string => computeOneSignalSignature(body, ONESIGNAL_WEBHOOK_SECRET);

  it('accepts a valid signature and reconciles a subscription change', async () => {
    const { controller, registry } = build(true);
    await expect(controller.handle(makeReq(body), validSig())).resolves.toEqual({ received: true });
    expect(registry.applySubscriptionWebhook).toHaveBeenCalledWith({ kind: 'unsubscribe', playerId: 'p1' });
  });

  it('P16: rejects a missing signature with 401 and NO mutation', async () => {
    const { controller, repo, registry } = build(true);
    await expect(controller.handle(makeReq(body), undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repo.recordWebhookEvent).not.toHaveBeenCalled();
    expect(registry.applySubscriptionWebhook).not.toHaveBeenCalled();
  });

  it('P16: rejects a tampered signature with 401 and NO mutation', async () => {
    const { controller, repo } = build(true);
    await expect(controller.handle(makeReq(body), 'deadbeef')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repo.recordWebhookEvent).not.toHaveBeenCalled();
  });

  it('P16: a duplicate provider_event_id is a no-op 200 (idempotent)', async () => {
    const { controller, registry } = build(false); // recordWebhookEvent returns false => already seen
    await expect(controller.handle(makeReq(body), validSig())).resolves.toEqual({ received: true });
    expect(registry.applySubscriptionWebhook).not.toHaveBeenCalled();
  });

  it('rejects a malformed body missing an event id', async () => {
    const { controller } = build(true);
    const malformed = JSON.stringify({ nothing: true });
    const sig = computeOneSignalSignature(malformed, ONESIGNAL_WEBHOOK_SECRET);
    await expect(controller.handle(makeReq(malformed), sig)).rejects.toBeInstanceOf(BadRequestException);
  });
});
