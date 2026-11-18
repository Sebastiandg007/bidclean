import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Interval } from '@nestjs/schedule';
import { Queue } from 'bullmq';

import { ObjectDeletionRepository } from './object-deletion.repository';
import { UploadGrantRepository } from './upload-grant.repository';
import { VoiceNoteRepository } from './voice-note.repository';
import { VoiceNoteStorageService } from './voice-note-storage.service';
import {
  VOICE_CLEANUP_BATCH_SIZE,
  VOICE_CLEANUP_INTERVAL_MS,
  VOICE_ORPHAN_RECONCILE_GRACE_MS,
  VOICE_TRANSCRIPTION_ENABLED,
  VOICE_TRANSCRIPTION_JOB_NAME,
  VOICE_TRANSCRIPTION_MAX_RETRIES,
  VOICE_TRANSCRIPTION_QUEUE_NAME,
  VOICE_TRANSCRIPTION_STUCK_THRESHOLD_MS,
} from './voice.constants';

/**
 * Voice-note cleanup & reconciliation worker (repeatable via @Interval).
 *
 * Runs four idempotent, bounded, eventually-consistent sweeps so audio never outlives (or precedes
 * without) its message and no note stays PENDING forever:
 *   A. Expired, still-ISSUED grants (abandoned/rejected sends, incl. the CLOSED-after-issue race):
 *      delete the orphan object + the grant.
 *   B. Tombstoned objects (a deleted/cascaded chat_voice_notes row): delete the MinIO object, mark
 *      the tombstone DONE.
 *   C. Reconciler backstop (runs on the same interval, defensive): delete aged bucket objects with
 *      no live voice note, no pending grant, and no pending tombstone.
 *   D. Stuck-PENDING transcripts (a lost best-effort enqueue): re-enqueue (claims a newer attempt)
 *      until the bounded max, then mark FAILED.
 *
 * Every step swallows per-item errors (logged, never the transcript/audio) so one failure never
 * stalls the sweep; the next tick retries. Registered with @nestjs/schedule (ScheduleModule).
 */
@Injectable()
export class VoiceNoteCleanupProcessor {
  private readonly logger = new Logger(VoiceNoteCleanupProcessor.name);

  constructor(
    private readonly grantRepository: UploadGrantRepository,
    private readonly voiceNoteRepository: VoiceNoteRepository,
    private readonly objectDeletionRepository: ObjectDeletionRepository,
    private readonly storage: VoiceNoteStorageService,
    @InjectQueue(VOICE_TRANSCRIPTION_QUEUE_NAME)
    private readonly transcriptionQueue: Queue,
  ) {}

  /** The configured sweep interval (ms), exposed for the @Interval decorator. */
  static getIntervalMs(): number {
    return VOICE_CLEANUP_INTERVAL_MS;
  }

  /** One repeatable pass over all sweeps. Never throws (each sweep is guarded). */
  @Interval(VoiceNoteCleanupProcessor.getIntervalMs())
  async sweep(): Promise<void> {
    await this.sweepExpiredGrants();
    await this.drainTombstones();
    await this.reconcileOrphanObjects();
    await this.sweepStuckPending();
  }

  /** A. Delete orphan objects from expired, still-ISSUED grants and remove the grants. */
  async sweepExpiredGrants(): Promise<void> {
    try {
      const expired = await this.grantRepository.findExpiredIssued(
        new Date(),
        VOICE_CLEANUP_BATCH_SIZE,
      );
      for (const grant of expired) {
        await this.storage.deleteObjectSafe(grant.objectKey);
        await this.grantRepository.deleteGrant(grant.objectKey);
      }
      if (expired.length > 0) {
        this.logger.debug(`Cleanup A swept ${expired.length} expired grant(s)`);
      }
    } catch (error) {
      this.logger.error(`Cleanup A (expired grants) failed: ${this.reason(error)}`);
    }
  }

  /** B. Drain tombstones: delete the MinIO object, mark DONE. Idempotent. */
  async drainTombstones(): Promise<void> {
    try {
      const pending = await this.objectDeletionRepository.findPending(VOICE_CLEANUP_BATCH_SIZE);
      for (const tombstone of pending) {
        await this.storage.deleteObjectSafe(tombstone.objectKey);
        await this.objectDeletionRepository.markDone(tombstone.id);
      }
      if (pending.length > 0) {
        this.logger.debug(`Cleanup B drained ${pending.length} tombstone(s)`);
      }
    } catch (error) {
      this.logger.error(`Cleanup B (tombstones) failed: ${this.reason(error)}`);
    }
  }

  /** C. Delete aged bucket objects unreferenced by any live note/grant/tombstone. */
  async reconcileOrphanObjects(): Promise<void> {
    try {
      const olderThan = new Date(Date.now() - VOICE_ORPHAN_RECONCILE_GRACE_MS);
      const keys = await this.storage.listObjectsOlderThan(olderThan, VOICE_CLEANUP_BATCH_SIZE);
      for (const objectKey of keys) {
        if (await this.isReferenced(objectKey)) {
          continue;
        }
        await this.storage.deleteObjectSafe(objectKey);
      }
    } catch (error) {
      this.logger.error(`Cleanup C (reconciler) failed: ${this.reason(error)}`);
    }
  }

  /** D. Re-enqueue stuck-PENDING transcripts (bounded), or mark FAILED when exhausted. */
  async sweepStuckPending(): Promise<void> {
    if (!VOICE_TRANSCRIPTION_ENABLED) {
      return;
    }
    try {
      const olderThan = new Date(Date.now() - VOICE_TRANSCRIPTION_STUCK_THRESHOLD_MS);
      const stuck = await this.voiceNoteRepository.findStuckPending(
        olderThan,
        VOICE_CLEANUP_BATCH_SIZE,
      );
      for (const note of stuck) {
        if (note.transcriptAttempt >= VOICE_TRANSCRIPTION_MAX_RETRIES) {
          await this.voiceNoteRepository.markFailed(note.messageId);
          continue;
        }
        await this.reenqueue(note.messageId);
      }
      if (stuck.length > 0) {
        this.logger.debug(`Cleanup D processed ${stuck.length} stuck-PENDING note(s)`);
      }
    } catch (error) {
      this.logger.error(`Cleanup D (stuck-PENDING) failed: ${this.reason(error)}`);
    }
  }

  /** Whether an object key is still referenced by a live note, pending grant, or tombstone. */
  private async isReferenced(objectKey: string): Promise<boolean> {
    if (await this.voiceNoteRepository.existsForObject(objectKey)) {
      return true;
    }
    if (await this.grantRepository.existsForObject(objectKey)) {
      return true;
    }
    return this.objectDeletionRepository.existsPendingForObject(objectKey);
  }

  /** Re-enqueue a transcription job for a stuck note; a failure is retried next tick. */
  private async reenqueue(messageId: string): Promise<void> {
    try {
      await this.transcriptionQueue.add(VOICE_TRANSCRIPTION_JOB_NAME, { messageId });
    } catch (error) {
      this.logger.warn(
        `Re-enqueue of stuck note ${messageId} failed; will retry next sweep: ${this.reason(error)}`,
      );
    }
  }

  /** Extract a safe error reason string (never audio/transcript content). */
  private reason(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown';
  }
}