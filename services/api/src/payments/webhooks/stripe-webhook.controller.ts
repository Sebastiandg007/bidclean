import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Request } from 'express';
import { StripeClient } from '../stripe/stripe.client';
import { PaymentsRepository } from '../payments.repository';
import { sanitizeStripePayload } from '../payment-payload.sanitizer';
import { PaymentEventSource } from '../payments.types';
import { PAYMENTS_JOB_NAMES, PAYMENTS_QUEUE_NAMES } from '../payments.constants';

/** Express request carrying the preserved raw body (enabled via NestFactory rawBody). */
interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

/**
 * Stripe webhook controller.
 *
 * NOT under the JWT guard — authenticated by the Stripe signature. Reads the RAW body,
 * verifies the signature within the tolerance window (400 on invalid/old, P9),
 * deduplicates by event id (P8), persists a sanitized event, enqueues async
 * processing, and returns a fast 2xx ACK.
 */
@Controller('payments/webhooks')
export class StripeWebhookController {
  constructor(
    private readonly stripe: StripeClient,
    private readonly repo: PaymentsRepository,
    @InjectQueue(PAYMENTS_QUEUE_NAMES.WEBHOOK)
    private readonly webhookQueue: Queue,
  ) {}

  /** POST /payments/webhooks/stripe */
  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  async handleStripeWebhook(
    @Req() req: RawBodyRequest,
    @Headers('stripe-signature') signature?: string,
  ): Promise<{ received: true }> {
    if (!signature) {
      throw new BadRequestException('Missing Stripe-Signature header');
    }
    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new BadRequestException('Missing raw request body');
    }

    let event;
    try {
      event = this.stripe.constructWebhookEvent(rawBody, signature);
    } catch (error) {
      // Invalid or too-old signature — reject, no mutation (P9).
      throw new BadRequestException(`Webhook signature verification failed: ${String(error)}`);
    }

    // Dedup by event id (P8): a redelivery is acknowledged without reprocessing.
    const alreadyProcessed = await this.repo.hasProcessedStripeEvent(event.id);
    if (alreadyProcessed) {
      return { received: true };
    }

    const sanitized = sanitizeStripePayload(event as never);
    await this.repo.appendEvent({
      paymentId: null,
      source: PaymentEventSource.WEBHOOK,
      eventType: event.type,
      stripeEventId: event.id,
      amountCents: sanitized.amountCents,
      currency: sanitized.currency,
      payload: sanitized,
    });

    await this.webhookQueue.add(PAYMENTS_JOB_NAMES.PROCESS_WEBHOOK, {
      stripeEventId: event.id,
      eventType: event.type,
      sanitized,
    });

    return { received: true };
  }
}
