import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { NotificationsRepository } from '../notifications.repository';
import { DeviceRegistryService } from '../device-registry.service';
import { verifyOneSignalWebhook } from './onesignal-signature';
import { ONESIGNAL_WEBHOOK_SECRET } from '../notifications.constants';

/** Express request carrying the preserved raw body (enabled via NestFactory rawBody). */
interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

/** Subscription-change event types OneSignal may report. */
const SUBSCRIPTION_EVENT_TYPES = new Set([
  'subscription.changed',
  'player.updated',
  'unsubscribe',
]);

/**
 * OneSignal webhook controller (public, HMAC).
 *
 * NOT under the JWT guard — authenticated by an HMAC-SHA256 signature over the RAW body. Rejects an
 * invalid/missing signature with 401 and NO mutation. Idempotent via a stored `provider_event_id`
 * (a redelivery is a no-op 200). Delivery callbacks update the ledger opportunistically (open/click
 * never drive business logic); subscription-change callbacks reconcile the device registry.
 */
@Controller('webhooks')
export class OneSignalWebhookController {
  private readonly logger = new Logger(OneSignalWebhookController.name);

  constructor(
    private readonly repo: NotificationsRepository,
    private readonly registry: DeviceRegistryService,
  ) {}

  /** POST /webhooks/onesignal */
  @Post('onesignal')
  @HttpCode(HttpStatus.OK)
  async handle(
    @Req() req: RawBodyRequest,
    @Headers('x-onesignal-signature') signature?: string,
  ): Promise<{ received: true }> {
    const rawBody = req.rawBody?.toString('utf8');
    if (rawBody === undefined) {
      throw new BadRequestException('Missing raw request body');
    }

    const auth = verifyOneSignalWebhook({ rawBody, signatureHeader: signature ?? null }, ONESIGNAL_WEBHOOK_SECRET);
    if (!auth.ok) {
      // Invalid/missing signature -> reject, no mutation (P16).
      throw new UnauthorizedException(`Webhook authentication failed: ${auth.reason}`);
    }

    const event = this.parseEvent(rawBody);
    if (!event.providerEventId || !event.eventType) {
      throw new BadRequestException('Malformed OneSignal event');
    }

    // Idempotent: a redelivered provider_event_id is a no-op (never re-mutates state).
    const isNew = await this.repo.recordWebhookEvent(event.providerEventId, event.eventType);
    if (!isNew) {
      return { received: true };
    }

    await this.route(event);
    return { received: true };
  }

  /** Route a first-seen event to registry reconciliation or opportunistic ledger update. */
  private async route(event: ParsedOneSignalEvent): Promise<void> {
    try {
      if (event.eventType !== null && SUBSCRIPTION_EVENT_TYPES.has(event.eventType) && event.playerId) {
        await this.registry.applySubscriptionWebhook({
          kind: 'unsubscribe',
          playerId: event.playerId,
        });
      }
      // Delivery/open/click callbacks are intentionally not required to mutate business state.
    } catch (error) {
      // Already deduped; a routing failure is logged, never surfaced as a 5xx to OneSignal.
      this.logger.warn(
        `OneSignal webhook routing failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  /** Defensively extract the id-based fields from OneSignal's (variable-shaped) payload. */
  private parseEvent(rawBody: string): ParsedOneSignalEvent {
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new BadRequestException('Invalid JSON body');
    }
    const obj = (typeof json === 'object' && json !== null ? json : {}) as Record<string, unknown>;
    return {
      providerEventId: readString(obj, ['event_id', 'id', 'notification_id']),
      eventType: readString(obj, ['event', 'event_type', 'type']),
      playerId: readString(obj, ['subscription_id', 'player_id', 'id']),
    };
  }
}

interface ParsedOneSignalEvent {
  readonly providerEventId: string | null;
  readonly eventType: string | null;
  readonly playerId: string | null;
}

/** Read the first present string field from a set of candidate keys. */
function readString(obj: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
}
