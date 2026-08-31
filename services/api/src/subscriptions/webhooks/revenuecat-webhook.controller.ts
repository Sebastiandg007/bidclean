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
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Request } from 'express';
import { SubscriptionsRepository } from '../subscriptions.repository';
import { sanitizeRevenueCatEvent } from '../revenuecat/revenuecat-payload.sanitizer';
import { verifyWebhook } from '../revenuecat/revenuecat-signature';
import { toEntitlementKeys } from '../revenuecat/revenuecat.constants';
import {
  REVENUECAT_WEBHOOK_AUTH_SECRET,
  REVENUECAT_WEBHOOK_SIGNING_SECRET,
  REVENUECAT_WEBHOOK_TOLERANCE_SECONDS,
  SUBSCRIPTION_JOB_NAME,
  SUBSCRIPTION_QUEUE_NAME,
} from '../subscriptions.constants';
import { Store } from '../subscriptions.types';

/** Express request carrying the preserved raw body (enabled via NestFactory rawBody). */
interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

/**
 * RevenueCat webhook controller (public, HMAC).
 *
 * NOT under the JWT guard — authenticated by an HMAC-SHA256 signature over the raw body
 * (bearer fallback). It deduplicates by event id, persists a sanitized ledger row as RECEIVED
 * (committed BEFORE the ACK), enqueues async processing (marking QUEUED), and returns a fast
 * `{ received: true }`. If enqueue fails, the RECEIVED row is recovered by the dispatch worker,
 * so an acknowledged event is never lost (P16).
 */
@Controller('webhooks')
export class RevenueCatWebhookController {
  private readonly logger = new Logger(RevenueCatWebhookController.name);

  constructor(
    private readonly repo: SubscriptionsRepository,
    @InjectQueue(SUBSCRIPTION_QUEUE_NAME)
    private readonly webhookQueue: Queue,
  ) {}

  /** POST /webhooks/revenuecat */
  @Post('revenuecat')
  @HttpCode(HttpStatus.OK)
  async handle(
    @Req() req: RawBodyRequest,
    @Headers('x-revenuecat-signature') signature?: string,
    @Headers('x-revenuecat-timestamp') timestamp?: string,
    @Headers('authorization') authorization?: string,
  ): Promise<{ received: true }> {
    const rawBody = req.rawBody?.toString('utf8');
    if (rawBody === undefined) {
      throw new BadRequestException('Missing raw request body');
    }

    this.authenticate(rawBody, signature ?? null, timestamp ?? null, authorization ?? null);

    const event = sanitizeRevenueCatEvent(JSON.parse(rawBody));
    if (!event.eventId || !event.type) {
      throw new BadRequestException('Malformed RevenueCat event');
    }

    // Dedup by event id: a redelivery is acknowledged without reprocessing.
    if (await this.repo.hasProcessedEvent(event.eventId)) {
      return { received: true };
    }

    // Persist RECEIVED (committed before ACK) so an acknowledged event is never lost.
    const ledgerId = await this.repo.appendEvent({
      revenuecatEventId: event.eventId,
      userId: event.appUserId,
      eventType: event.type,
      entitlementIds: toEntitlementKeys(event.entitlementIds),
      store: (event.store as Store | null) ?? null,
      eventTimestampMs: event.eventTimestampMs ?? Date.now(),
      expirationAt: event.expirationAtMs !== null ? new Date(event.expirationAtMs) : null,
      payload: { ...event },
    });

    // A concurrent redelivery may have won the insert race; treat as already received.
    if (ledgerId === null) {
      return { received: true };
    }

    await this.enqueue(ledgerId, event.eventId);
    return { received: true };
  }

  /** Verify HMAC (preferred) or bearer; reject with 401 and NO mutation on failure. */
  private authenticate(
    rawBody: string,
    signature: string | null,
    timestamp: string | null,
    authorization: string | null,
  ): void {
    const result = verifyWebhook(
      { rawBody, signatureHeader: signature, timestampHeader: timestamp, authorizationHeader: authorization },
      {
        signingSecret: REVENUECAT_WEBHOOK_SIGNING_SECRET,
        authSecret: REVENUECAT_WEBHOOK_AUTH_SECRET,
        toleranceSeconds: REVENUECAT_WEBHOOK_TOLERANCE_SECONDS,
      },
    );
    if (!result.ok) {
      throw new UnauthorizedException(`Webhook authentication failed: ${result.reason}`);
    }
  }

  /** Enqueue processing (best-effort) and mark QUEUED; a failure leaves the row recoverable. */
  private async enqueue(ledgerId: string, revenuecatEventId: string): Promise<void> {
    try {
      await this.webhookQueue.add(SUBSCRIPTION_JOB_NAME, { ledgerId, revenuecatEventId });
      await this.repo.markQueued(ledgerId);
    } catch (error) {
      // Do not fail the ACK: the RECEIVED row is picked up by the dispatch recovery worker.
      this.logger.warn(
        `Enqueue failed for event ${revenuecatEventId}; leaving RECEIVED for recovery`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
