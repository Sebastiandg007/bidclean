import { ObjectDeletionStatus, VerificationState } from '../video-verification.types';
import {
  buildVerificationStack,
  seedPendingVerification,
  VerificationStack,
} from './support/build-verification-stack';

/** Force a row's timestamp fields into the past so sweeps select it. */
function ageRow(stack: VerificationStack, id: string, msAgo: number): void {
  const row = stack.db.verifications.find((v) => v.id === id);
  if (row) {
    const past = new Date(Date.now() - msAgo);
    row.created_at = past;
    row.updated_at = past;
    if (row.uploaded_at) {
      row.uploaded_at = past;
    }
  }
}

describe('UploadWindowSweep', () => {
  it('transitions PENDING_UPLOAD → EXPIRED past the window (idempotent, single-winner)', async () => {
    const stack = buildVerificationStack();
    const id = await seedPendingVerification(stack);
    ageRow(stack, id, 3_600_000);
    await stack.uploadSweep.sweepOnce();
    expect(stack.db.verifications.find((v) => v.id === id)?.state).toBe(VerificationState.EXPIRED);
    // A second pass is a no-op (already EXPIRED).
    await stack.uploadSweep.sweepOnce();
    expect(stack.db.verifications.find((v) => v.id === id)?.state).toBe(VerificationState.EXPIRED);
    expect(stack.db.outbox).toHaveLength(0);
  });
});

describe('StuckProcessingSweep', () => {
  it('re-enqueues a stuck UPLOADED row', async () => {
    const stack = buildVerificationStack();
    const id = await seedPendingVerification(stack);
    const row = stack.db.verifications.find((v) => v.id === id);
    if (row) {
      row.state = VerificationState.UPLOADED;
      row.object_key = 'ab/v';
    }
    ageRow(stack, id, 3_600_000);
    await stack.stuckSweep.sweepOnce();
    expect(stack.queue.jobs).toEqual([{ verificationId: id }]);
  });

  it('retries a stuck PROCESSING row (bumps attempt) and re-enqueues', async () => {
    const stack = buildVerificationStack();
    const id = await seedPendingVerification(stack);
    const row = stack.db.verifications.find((v) => v.id === id);
    if (row) {
      row.state = VerificationState.PROCESSING;
      row.processing_attempt = 1;
    }
    ageRow(stack, id, 3_600_000);
    await stack.stuckSweep.sweepOnce();
    expect(stack.db.verifications.find((v) => v.id === id)?.processing_attempt).toBe(2);
    expect(stack.queue.jobs).toEqual([{ verificationId: id }]);
  });

  it('marks FAILED (MAX_ATTEMPTS) after the bounded retries are exhausted', async () => {
    const stack = buildVerificationStack();
    const id = await seedPendingVerification(stack);
    const row = stack.db.verifications.find((v) => v.id === id);
    if (row) {
      row.state = VerificationState.PROCESSING;
      row.processing_attempt = 3; // == VIDEO_VERIFICATION_MAX_RETRIES default
    }
    ageRow(stack, id, 3_600_000);
    await stack.stuckSweep.sweepOnce();
    const after = stack.db.verifications.find((v) => v.id === id);
    expect(after?.state).toBe(VerificationState.FAILED);
    expect(after?.failure_reason).toBe('MAX_ATTEMPTS');
    expect(stack.queue.jobs).toHaveLength(0);
  });
});

describe('RetentionCleanupProcessor', () => {
  it('hard-deletes the video past the horizon (clock = uploaded_at) and sets video_deleted_at once', async () => {
    const stack = buildVerificationStack();
    const id = await seedPendingVerification(stack);
    const row = stack.db.verifications.find((v) => v.id === id);
    if (row) {
      row.state = VerificationState.MATCH;
      row.object_key = 'ab/old-video';
      row.uploaded_at = new Date(Date.now() - 1000 * 60 * 60 * 72); // 72h ago (> 48h)
    }
    stack.storage.putObject('ab/old-video', {
      sizeBytes: 1,
      contentType: 'video/mp4',
      durationMs: 5000,
      bytes: Buffer.from('x'),
    });
    await stack.retention.sweepOnce();
    expect(stack.storage.deleted).toContain('ab/old-video');
    const after = stack.db.verifications.find((v) => v.id === id);
    expect(after?.video_deleted_at).not.toBeNull();
    // Record + derived result persist (no deleted_at on the record).
    expect(after?.state).toBe(VerificationState.MATCH);
    // Second pass is idempotent — no re-mark.
    const firstDeletedAt = after?.video_deleted_at;
    await stack.retention.sweepOnce();
    expect(stack.db.verifications.find((v) => v.id === id)?.video_deleted_at).toEqual(firstDeletedAt);
  });

  it('does not delete a video within the retention window', async () => {
    const stack = buildVerificationStack();
    const id = await seedPendingVerification(stack);
    const row = stack.db.verifications.find((v) => v.id === id);
    if (row) {
      row.state = VerificationState.MATCH;
      row.object_key = 'ab/fresh';
      row.uploaded_at = new Date(); // just now
    }
    stack.storage.putObject('ab/fresh', {
      sizeBytes: 1,
      contentType: 'video/mp4',
      durationMs: 5000,
      bytes: Buffer.from('x'),
    });
    await stack.retention.sweepOnce();
    expect(stack.storage.deleted).not.toContain('ab/fresh');
  });
});

describe('TombstoneDrainProcessor', () => {
  it('drains PENDING tombstones idempotently and marks DONE', async () => {
    const stack = buildVerificationStack();
    stack.db.tombstones.push({ objectKey: 'ab/gone', status: ObjectDeletionStatus.PENDING });
    await stack.tombstoneDrain.sweepOnce();
    expect(stack.storage.deleted).toContain('ab/gone');
    expect(stack.db.tombstones[0]?.status).toBe(ObjectDeletionStatus.DONE);
    // Second pass is a no-op (no PENDING rows).
    stack.storage.deleted = [];
    await stack.tombstoneDrain.sweepOnce();
    expect(stack.storage.deleted).toHaveLength(0);
  });
});
