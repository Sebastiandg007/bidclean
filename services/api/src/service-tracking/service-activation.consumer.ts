import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import {
  SERVICE_ACTIVATION_DRAIN_BATCH_SIZE,
  SERVICE_ACTIVATION_DRAIN_INTERVAL_MS,
} from './service-tracking.constants';
import { ServiceSessionRepository } from './service-session.repository';
import { ServiceSessionService } from './service-session.service';

/**
 * ServiceActivationConsumer — drains the upstream `service_activation_ready` outbox (Spec 17).
 *
 * service-tracking is one of potentially several consumers of the offer/escrow-owned
 * `service_activation_outbox`, so it drains via its OWN per-consumer checkpoint
 * (`service_activation_consumed`, a `NOT EXISTS` scan) rather than mutating a shared `relayed_at`
 * on a table it does not own. For each unconsumed row it calls `createFromActivation` (idempotent on
 * `UNIQUE offer_id`) then records its ack. A row-scoped catch isolates a failure from the source
 * match/escrow flow and leaves the row re-drainable (the ack is only written on success).
 */
@Injectable()
export class ServiceActivationConsumer {
  private readonly logger = new Logger(ServiceActivationConsumer.name);

  constructor(
    private readonly repository: ServiceSessionRepository,
    private readonly sessionService: ServiceSessionService,
  ) {}

  /** Static so the decorator can read the configured interval. */
  static getInterval(): number {
    return SERVICE_ACTIVATION_DRAIN_INTERVAL_MS;
  }

  @Interval(ServiceActivationConsumer.getInterval())
  async drain(): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      // Tests drive `drainOnce()` directly; no scheduled draining under test.
      return;
    }
    await this.drainOnce();
  }

  /** One bounded drain pass. Each row is handled independently (row-scoped failure isolation). */
  async drainOnce(): Promise<void> {
    const rows = await this.repository.findActivationUnconsumed(SERVICE_ACTIVATION_DRAIN_BATCH_SIZE);
    for (const row of rows) {
      await this.consumeRow(row.eventId, row.payload);
    }
  }

  /** Create the session then ack; on failure leave the row re-drainable (no ack written). */
  private async consumeRow(
    eventId: string,
    payload: Parameters<ServiceSessionService['createFromActivation']>[0],
  ): Promise<void> {
    try {
      await this.sessionService.createFromActivation(payload);
      await this.repository.markActivationConsumed(eventId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`Activation consume failed for ${eventId} (re-drainable): ${reason}`);
    }
  }
}
