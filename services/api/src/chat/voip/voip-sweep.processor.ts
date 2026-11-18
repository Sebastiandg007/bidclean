import { Inject, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';

import { chatChannelForConversation } from '../chat.constants';
import {
  ChatRealtimePublisher,
  CHAT_REALTIME_PUBLISHER,
} from '../chat.service';
import { VoipRepository, VoipCallRow } from './voip.repository';
import {
  CallStatus,
  EndReason,
  VOIP_MAX_CALL_DURATION_MS,
  VOIP_RING_TIMEOUT_MS,
  VOIP_STALE_CALL_TIMEOUT_MS,
  VOIP_SWEEP_BATCH_SIZE,
  VOIP_SWEEP_INTERVAL_MS,
  VOIP_SWEEP_JOB_NAME,
  VOIP_SWEEP_QUEUE_NAME,
} from './voip.constants';
import { SignalEventType } from './voip.types';

/**
 * VoipSweepProcessor — the two bounded, idempotent force-end sweeps (BullMQ repeatable).
 *
 * On module init it registers a single repeatable job on the voip-sweep queue at
 * `VOIP_SWEEP_INTERVAL_MS`; each run performs:
 *   (A) ring-timeout — `RINGING` older than `VOIP_RING_TIMEOUT_MS` → single-winner `MISSED` /
 *       `TIMEOUT_NO_ANSWER`;
 *   (B) stale-call — `ONGOING` whose LiveKit-webhook-driven `last_media_activity_at` is older than
 *       `VOIP_STALE_CALL_TIMEOUT_MS` (or whose `answered_at` exceeds `VOIP_MAX_CALL_DURATION_MS`) →
 *       single-winner `ENDED` / `TIMEOUT`.
 * Every terminal write is the single-winner conditional update, so a sweep can never double-derive a
 * duration or race a concurrent hangup. Both best-effort publish `call_end`; a per-item failure is
 * logged and never stalls the batch (the next tick retries). An ordinary timeout is NEVER FAILED/
 * ERROR — that status is reserved for genuine failures (set elsewhere).
 */
@Processor(VOIP_SWEEP_QUEUE_NAME)
export class VoipSweepProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(VoipSweepProcessor.name);

  constructor(
    @InjectQueue(VOIP_SWEEP_QUEUE_NAME)
    private readonly sweepQueue: Queue,
    private readonly voipRepository: VoipRepository,
    @Inject(CHAT_REALTIME_PUBLISHER)
    private readonly publisher: ChatRealtimePublisher,
  ) {
    super();
  }

  /** Register the repeatable sweep job (idempotent by jobId across restarts). */
  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      // Tests drive `sweep()` / `process()` directly; no repeatable scheduling under test.
      return;
    }
    try {
      await this.sweepQueue.add(
        VOIP_SWEEP_JOB_NAME,
        {},
        {
          jobId: VOIP_SWEEP_JOB_NAME,
          repeat: { every: VOIP_SWEEP_INTERVAL_MS },
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      this.logger.error(`Failed to schedule the voip sweep: ${reason}`);
    }
  }

  /** BullMQ entry point: one repeatable tick runs both sweeps. Never throws (each sweep is guarded). */
  async process(_job: Job): Promise<void> {
    await this.sweep();
  }

  /** One pass over both sweeps. */
  async sweep(): Promise<void> {
    await this.sweepRingTimeouts();
    await this.sweepStaleCalls();
  }

  /** (A) Force unanswered RINGING calls past the ring window to MISSED / TIMEOUT_NO_ANSWER. */
  async sweepRingTimeouts(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - VOIP_RING_TIMEOUT_MS);
      const aged = await this.voipRepository.findRingingOlderThan(cutoff, VOIP_SWEEP_BATCH_SIZE);
      for (const call of aged) {
        await this.forceEnd(
          call.id,
          call.conversationId,
          CallStatus.RINGING,
          CallStatus.MISSED,
          EndReason.TIMEOUT_NO_ANSWER,
        );
      }
      if (aged.length > 0) {
        this.logger.debug(`Ring-timeout sweep force-ended ${aged.length} call(s)`);
      }
    } catch (error) {
      this.logger.error(`Ring-timeout sweep failed: ${this.reason(error)}`);
    }
  }

  /** (B) Force stale/over-long ONGOING calls to ENDED / TIMEOUT. */
  async sweepStaleCalls(): Promise<void> {
    try {
      const now = Date.now();
      const staleBefore = new Date(now - VOIP_STALE_CALL_TIMEOUT_MS);
      const maxDurationBefore = new Date(now - VOIP_MAX_CALL_DURATION_MS);
      const stale = await this.voipRepository.findStaleOngoing(
        staleBefore,
        maxDurationBefore,
        VOIP_SWEEP_BATCH_SIZE,
      );
      for (const call of stale) {
        await this.forceEnd(
          call.id,
          call.conversationId,
          CallStatus.ONGOING,
          CallStatus.ENDED,
          EndReason.TIMEOUT,
        );
      }
      if (stale.length > 0) {
        this.logger.debug(`Stale-call sweep force-ended ${stale.length} call(s)`);
      }
    } catch (error) {
      this.logger.error(`Stale-call sweep failed: ${this.reason(error)}`);
    }
  }

  /** Single-winner terminal write + best-effort call_end. A lost race is a silent no-op. */
  private async forceEnd(
    callId: string,
    conversationId: string,
    expected: CallStatus,
    terminalStatus: CallStatus,
    endReason: EndReason,
  ): Promise<void> {
    const winner = await this.voipRepository.transitionTerminal(
      callId,
      expected,
      terminalStatus,
      endReason,
    );
    if (winner) {
      await this.publishEnd(conversationId, winner, endReason);
    }
  }

  /** Best-effort `call_end` publish; a transport failure never fails the sweep. */
  private async publishEnd(
    conversationId: string,
    winner: VoipCallRow,
    endReason: EndReason,
  ): Promise<void> {
    try {
      await this.publisher.publish(chatChannelForConversation(conversationId), {
        type: SignalEventType.CALL_END,
        callId: winner.id,
        endReason,
        durationSeconds: winner.duration_seconds,
      });
    } catch (error) {
      this.logger.warn(`Sweep call_end publish failed for call ${winner.id}: ${this.reason(error)}`);
    }
  }

  /** Extract a safe error reason string (never media/PII). */
  private reason(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown';
  }
}
