import { Inject, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';

import {
  SERVICE_EN_ROUTE_STALE_MS,
  SERVICE_SESSION_ABANDON_MS,
  SERVICE_SWEEP_BATCH_SIZE,
  SERVICE_SWEEP_INTERVAL_MS,
  SERVICE_SWEEP_JOB_NAME,
  SERVICE_SWEEP_QUEUE_NAME,
  serviceChannelForSession,
} from './service-tracking.constants';
import { ServiceSessionRepository } from './service-session.repository';
import { ServiceRealtimePublisher, SERVICE_REALTIME_PUBLISHER } from './service-session.service';
import { EndedReason, SessionState } from './service-tracking.types';

/**
 * ServiceSweepProcessor — bounded, idempotent force-expiry so no session is stuck (Spec 17).
 *
 * On module init it registers a single repeatable job at `SERVICE_SWEEP_INTERVAL_MS`; each run:
 *   (A) abandon sweep — `MATCHED` older than `SERVICE_SESSION_ABANDON_MS` → `EXPIRED`
 *       (`EXPIRED_NEVER_STARTED`);
 *   (B) stale sweep — `EN_ROUTE` with no eligible progress within `SERVICE_EN_ROUTE_STALE_MS`
 *       (via `last_progress_at`) → `EXPIRED` (`EXPIRED_NO_PROGRESS`).
 * Each expiry is a single-winner conditional write with a best-effort state signal. A mere property
 * deletion does NOT expire a session (the geofence uses the snapshot); `EXPIRED_PROPERTY_REMOVED` is
 * reserved for an unusable snapshot, which the NOT NULL schema prevents in normal operation. A
 * per-item failure is logged and never stalls the batch (the next tick retries).
 */
@Processor(SERVICE_SWEEP_QUEUE_NAME)
export class ServiceSweepProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ServiceSweepProcessor.name);

  constructor(
    @InjectQueue(SERVICE_SWEEP_QUEUE_NAME)
    private readonly sweepQueue: Queue,
    private readonly repository: ServiceSessionRepository,
    @Inject(SERVICE_REALTIME_PUBLISHER)
    private readonly publisher: ServiceRealtimePublisher,
  ) {
    super();
  }

  /** Register the repeatable sweep job (idempotent by jobId across restarts). */
  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    try {
      await this.sweepQueue.add(
        SERVICE_SWEEP_JOB_NAME,
        {},
        {
          jobId: SERVICE_SWEEP_JOB_NAME,
          repeat: { every: SERVICE_SWEEP_INTERVAL_MS },
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      this.logger.error(`Failed to schedule the service-tracking sweep: ${reason}`);
    }
  }

  /** BullMQ entry point: one repeatable tick runs both sweeps. Never throws (each sweep is guarded). */
  async process(_job: Job): Promise<void> {
    await this.sweep();
  }

  /** One pass over both sweeps. */
  async sweep(): Promise<void> {
    await this.sweepAbandoned();
    await this.sweepStaleEnRoute();
  }

  /** (A) Force MATCHED sessions past the abandon window to EXPIRED / EXPIRED_NEVER_STARTED. */
  async sweepAbandoned(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - SERVICE_SESSION_ABANDON_MS);
      const ids = await this.repository.findAbandonedMatched(cutoff, SERVICE_SWEEP_BATCH_SIZE);
      for (const id of ids) {
        await this.expire(id, SessionState.MATCHED, EndedReason.EXPIRED_NEVER_STARTED);
      }
    } catch (error) {
      this.logger.error(`Abandon sweep failed: ${this.reason(error)}`);
    }
  }

  /** (B) Force stale EN_ROUTE sessions to EXPIRED / EXPIRED_NO_PROGRESS. */
  async sweepStaleEnRoute(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - SERVICE_EN_ROUTE_STALE_MS);
      const ids = await this.repository.findExpirableEnRoute(cutoff, SERVICE_SWEEP_BATCH_SIZE);
      for (const id of ids) {
        await this.expire(id, SessionState.EN_ROUTE, EndedReason.EXPIRED_NO_PROGRESS);
      }
    } catch (error) {
      this.logger.error(`Stale sweep failed: ${this.reason(error)}`);
    }
  }

  /** Single-winner EXPIRED write + best-effort state signal. A lost race is a silent no-op. */
  private async expire(id: string, expected: SessionState, reason: EndedReason): Promise<void> {
    const winner = await this.repository.transition(
      id,
      expected,
      SessionState.EXPIRED,
      { endedReason: reason },
      null,
    );
    if (winner) {
      await this.publishExpired(id, reason);
    }
  }

  /** Best-effort `state` signal publish; a transport failure never fails the sweep. */
  private async publishExpired(sessionId: string, reason: EndedReason): Promise<void> {
    try {
      await this.publisher.publish(serviceChannelForSession(sessionId), {
        type: 'state',
        state: SessionState.EXPIRED,
        endedReason: reason,
      });
    } catch {
      this.logger.warn(`Sweep state publish failed for session ${sessionId}`);
    }
  }

  /** Extract a safe error reason string (never a coordinate/PII). */
  private reason(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown';
  }
}
