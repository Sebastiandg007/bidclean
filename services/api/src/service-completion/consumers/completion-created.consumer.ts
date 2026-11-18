import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import {
  COMPLETION_OUTBOX_CONSUMER_NAME,
  SERVICE_COMPLETION_CREATION_DRAIN_BATCH_SIZE,
  SERVICE_COMPLETION_CREATION_DRAIN_INTERVAL_MS,
} from '../completion.constants';
import { ChecklistCompletedPayload } from '../completion.types';
import { ChecklistOutboxConsumerCheckpoint } from '../repository/checklist-outbox-consumer.checkpoint';
import { CompletionCreationService } from '../service/completion-creation.service';

/** The `checklist_completed` event type emitted by checklist-photos (Spec 19). */
const CHECKLIST_COMPLETED_EVENT_TYPE = 'checklist_completed';

/**
 * CompletionCreatedConsumer — drains the durable `checklist_completed` event (Spec 20).
 *
 * service-completion is a consumer of checklist-photos' `checklist_outbox` fan-out, so it drains via
 * its OWN per-consumer checkpoint (`consumer_name = 'completion'`), never mutating a shared marker.
 * For each unacked `checklist_completed` row it calls `createFromChecklistCompleted(payload)`
 * (idempotent on `UNIQUE service_session_id`) then acks only its own `(event_id, 'completion')` row.
 * A row-scoped catch isolates a failure from the source checklist finalize and leaves the row
 * re-drainable (the ack is only written on success).
 */
@Injectable()
export class CompletionCreatedConsumer {
  private readonly logger = new Logger(CompletionCreatedConsumer.name);

  constructor(
    private readonly checkpoint: ChecklistOutboxConsumerCheckpoint,
    private readonly creation: CompletionCreationService,
  ) {}

  /** Static so the decorator can read the configured interval. */
  static getIntervalMs(): number {
    return SERVICE_COMPLETION_CREATION_DRAIN_INTERVAL_MS;
  }

  @Interval(CompletionCreatedConsumer.getIntervalMs())
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
      COMPLETION_OUTBOX_CONSUMER_NAME,
      SERVICE_COMPLETION_CREATION_DRAIN_BATCH_SIZE,
    );
    for (const row of rows) {
      if (row.type !== CHECKLIST_COMPLETED_EVENT_TYPE) {
        await this.ackQuietly(row.eventId);
        continue;
      }
      await this.consumeRow(row.eventId, row.payload);
    }
  }

  /** Create the completion then ack; on failure leave the row re-drainable (no ack written). */
  private async consumeRow(eventId: string, payload: Record<string, unknown>): Promise<void> {
    try {
      await this.creation.createFromChecklistCompleted(toChecklistCompletedPayload(payload));
      await this.checkpoint.ack(eventId, COMPLETION_OUTBOX_CONSUMER_NAME);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`Completion creation failed for ${eventId} (re-drainable): ${reason}`);
    }
  }

  /** Ack an unrelated event type, swallowing failures (it re-drains and re-acks next pass). */
  private async ackQuietly(eventId: string): Promise<void> {
    try {
      await this.checkpoint.ack(eventId, COMPLETION_OUTBOX_CONSUMER_NAME);
    } catch {
      // No-op; a failed ack simply re-drains next pass (idempotent).
    }
  }
}

/** Map a raw `checklist_completed` payload into the typed shape (defensive on missing fields). */
export function toChecklistCompletedPayload(
  payload: Record<string, unknown>,
): ChecklistCompletedPayload {
  return {
    runId: String(payload.runId ?? ''),
    serviceSessionId: String(payload.serviceSessionId ?? ''),
    totalTasks: Number(payload.totalTasks ?? 0),
    completedTasks: Number(payload.completedTasks ?? 0),
    photoCount: Number(payload.photoCount ?? 0),
    completedAt: typeof payload.completedAt === 'string' ? payload.completedAt : '',
  };
}
