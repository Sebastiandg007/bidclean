import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import {
  CHECKLIST_OUTBOX_CONSUMER_NAME,
  CHECKLIST_STARTED_DRAIN_BATCH_SIZE,
  CHECKLIST_STARTED_DRAIN_INTERVAL_MS,
} from '../checklist.constants';
import { ChecklistRunCreationService } from '../service/checklist-run-creation.service';
import { ServiceOutboxConsumerCheckpoint } from '../../service-tracking/service-outbox-consumer.checkpoint';
import { ServiceOutboxEventType } from '../../service-tracking/service-tracking.types';
import { StartedPayload } from '../checklist.types';
import { toStartedPayload } from './started-payload.mapper';

/**
 * ChecklistStartedConsumer — drains the durable `service_started` event (Spec 19).
 *
 * checklist-photos is one consumer of service-tracking's `service_outbox` fan-out, so it drains via
 * its OWN per-consumer checkpoint (`consumer_name = 'checklist'`) — reusing Spec 17's
 * `ServiceOutboxConsumerCheckpoint` (never duplicated), never mutating a shared marker, never
 * reading `service_sessions.state`. For each unacked `service_started` row it calls
 * `createFromStarted(payload)` (idempotent on `UNIQUE service_session_id`) then acks only its own
 * `(event_id, 'checklist')` row. A row-scoped catch isolates a failure from the source start flow
 * and leaves the row re-drainable (the ack is only written on success).
 */
@Injectable()
export class ChecklistStartedConsumer {
  private readonly logger = new Logger(ChecklistStartedConsumer.name);

  constructor(
    private readonly checkpoint: ServiceOutboxConsumerCheckpoint,
    private readonly creation: ChecklistRunCreationService,
  ) {}

  /** Static so the decorator can read the configured interval. */
  static getInterval(): number {
    return CHECKLIST_STARTED_DRAIN_INTERVAL_MS;
  }

  @Interval(ChecklistStartedConsumer.getInterval())
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
      CHECKLIST_OUTBOX_CONSUMER_NAME,
      CHECKLIST_STARTED_DRAIN_BATCH_SIZE,
    );
    for (const row of rows) {
      if (row.type !== ServiceOutboxEventType.STARTED) {
        // Only `service_started` creates a run; ack unrelated types so they don't re-drain forever.
        await this.ackQuietly(row.eventId);
        continue;
      }
      await this.consumeRow(row.eventId, row.payload);
    }
  }

  /** Create the run then ack; on failure leave the row re-drainable (no ack written). */
  private async consumeRow(eventId: string, payload: Record<string, unknown>): Promise<void> {
    try {
      const started: StartedPayload = toStartedPayload(payload);
      await this.creation.createFromStarted(started);
      await this.checkpoint.ack(eventId, CHECKLIST_OUTBOX_CONSUMER_NAME);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`Checklist run creation failed for ${eventId} (re-drainable): ${reason}`);
    }
  }

  /** Ack an unrelated event type, swallowing failures (it will re-drain and re-ack next pass). */
  private async ackQuietly(eventId: string): Promise<void> {
    try {
      await this.checkpoint.ack(eventId, CHECKLIST_OUTBOX_CONSUMER_NAME);
    } catch {
      // No-op; a failed ack simply re-drains next pass (idempotent).
    }
  }
}
