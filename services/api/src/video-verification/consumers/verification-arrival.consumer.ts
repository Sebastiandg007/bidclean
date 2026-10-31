import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { ServiceOutboxConsumerCheckpoint } from '../../service-tracking/service-outbox-consumer.checkpoint';
import { UnackedOutboxRow } from '../../service-tracking/service-session.repository';
import { ServiceOutboxEventType } from '../../service-tracking/service-tracking.types';
import {
  VIDEO_VERIFICATION_ARRIVAL_DRAIN_BATCH_SIZE,
  VIDEO_VERIFICATION_ARRIVAL_DRAIN_INTERVAL_MS,
  VIDEO_VERIFICATION_CONSUMER_NAME,
} from '../video-verification.constants';
import { ArrivalPayload } from '../video-verification.types';
import { VerificationCreationService } from '../service/verification-creation.service';

/**
 * VerificationArrivalConsumer (relay) — drains the `service_arrived` fan-out for this module.
 *
 * Reuses Spec 17's `ServiceOutboxConsumerCheckpoint` under `consumer_name = 'video'` (its OWN
 * per-consumer checkpoint over `service_outbox`), so the Spec 16 notifications consumer acking the
 * same event never starves it. For each unacked row it calls `createFromArrival` (idempotent on
 * `UNIQUE service_session_id`), then acks its own `(event_id, 'video')` row on success. A row-scoped
 * try/catch isolates one bad row from the batch and leaves it re-drainable (the ack is only written
 * on success). Only `service_arrived` rows seed a verification; other service_* types are acked
 * as no-ops so they do not re-drain forever.
 */
@Injectable()
export class VerificationArrivalConsumer {
  private readonly logger = new Logger(VerificationArrivalConsumer.name);

  constructor(
    private readonly checkpoint: ServiceOutboxConsumerCheckpoint,
    private readonly creationService: VerificationCreationService,
  ) {}

  /** Static so the decorator can read the configured interval. */
  static getInterval(): number {
    return VIDEO_VERIFICATION_ARRIVAL_DRAIN_INTERVAL_MS;
  }

  @Interval(VerificationArrivalConsumer.getInterval())
  async drain(): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      // Tests drive `drainOnce()` directly; no scheduled draining under test.
      return;
    }
    await this.drainOnce();
  }

  /** One bounded drain pass. Each row is handled independently (row-scoped failure isolation). */
  async drainOnce(): Promise<void> {
    const rows = await this.checkpoint.drainUnacked(
      VIDEO_VERIFICATION_CONSUMER_NAME,
      VIDEO_VERIFICATION_ARRIVAL_DRAIN_BATCH_SIZE,
    );
    for (const row of rows) {
      await this.consumeRow(row);
    }
  }

  /** Create the verification (only for arrivals) then ack; on failure leave the row re-drainable. */
  private async consumeRow(row: UnackedOutboxRow): Promise<void> {
    try {
      if (row.type === ServiceOutboxEventType.ARRIVED) {
        await this.creationService.createFromArrival(this.toArrivalPayload(row.payload));
      }
      await this.checkpoint.ack(row.eventId, VIDEO_VERIFICATION_CONSUMER_NAME);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`Arrival consume failed for ${row.eventId} (re-drainable): ${reason}`);
    }
  }

  /** Map the ids-only outbox payload to the internal arrival contract. */
  private toArrivalPayload(payload: Record<string, unknown>): ArrivalPayload {
    return {
      sessionId: String(payload.sessionId),
      offerId: String(payload.offerId),
      cleanerId: payload.cleanerId === null ? null : String(payload.cleanerId),
      hostId: payload.hostId === null ? null : String(payload.hostId),
      arrivalDistanceM:
        typeof payload.arrivalDistanceM === 'number' ? payload.arrivalDistanceM : undefined,
    };
  }
}
