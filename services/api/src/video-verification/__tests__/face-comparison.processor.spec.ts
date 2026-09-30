import { Job } from 'bullmq';

import { FaceVerifyTimeoutError } from '../ai-client/face-verify.types';
import { ComparisonJobData } from '../service/verification.service';
import { Decision, VerificationState } from '../video-verification.types';
import {
  buildVerificationStack,
  seedPendingVerification,
  VerificationStack,
} from './support/build-verification-stack';

/** Drive a verification to UPLOADED with a stored video + a configured reference selfie. */
async function toUploaded(
  stack: VerificationStack,
  options: { reference: Buffer | null; objectKey?: string } = { reference: Buffer.from('ref') },
): Promise<string> {
  const id = await seedPendingVerification(stack);
  const row = stack.db.verifications.find((v) => v.id === id);
  const objectKey = options.objectKey ?? 'ab/vid-1';
  if (row) {
    row.state = VerificationState.UPLOADED;
    row.object_key = objectKey;
    row.uploaded_at = new Date();
  }
  stack.storage.putObject(objectKey, {
    sizeBytes: 1024,
    contentType: 'video/mp4',
    durationMs: 8000,
    bytes: Buffer.from('video'),
  });
  stack.kycReader.setSelfie('cleaner-1', options.reference);
  return id;
}

function job(verificationId: string): Job<ComparisonJobData> {
  return { data: { verificationId } } as Job<ComparisonJobData>;
}

describe('FaceComparisonProcessor', () => {
  let stack: VerificationStack;

  beforeEach(() => {
    stack = buildVerificationStack();
  });

  it('MATCH when score >= snapshot threshold; emits verification_completed only (no flag)', async () => {
    const id = await toUploaded(stack);
    stack.faceVerify.next = { score: 0.91, decision: Decision.MATCH };
    await stack.processor.process(job(id));
    const row = stack.db.verifications.find((v) => v.id === id);
    expect(row?.state).toBe(VerificationState.MATCH);
    expect(row?.match_score).toBe('0.9100');
    const types = stack.db.outbox.map((o) => o.type);
    expect(types).toEqual(['verification_completed']);
  });

  it('NO_MATCH when score < snapshot threshold; emits completed + flagged', async () => {
    const id = await toUploaded(stack);
    stack.faceVerify.next = { score: 0.2, decision: Decision.MATCH }; // decision from AI ignored; snapshot decides
    await stack.processor.process(job(id));
    const row = stack.db.verifications.find((v) => v.id === id);
    expect(row?.state).toBe(VerificationState.NO_MATCH);
    const types = stack.db.outbox.map((o) => o.type).sort();
    expect(types).toEqual(['verification_completed', 'verification_flagged']);
  });

  it('uses the ROW snapshot threshold, not live config', async () => {
    const id = await toUploaded(stack);
    const row = stack.db.verifications.find((v) => v.id === id);
    if (row) {
      row.match_threshold = '0.9500'; // snapshot raised
    }
    stack.faceVerify.next = { score: 0.9, decision: Decision.MATCH };
    await stack.processor.process(job(id));
    expect(stack.db.verifications.find((v) => v.id === id)?.state).toBe(VerificationState.NO_MATCH);
  });

  it('missing reference → INCONCLUSIVE (non-fatal), emits completed + flagged', async () => {
    const id = await toUploaded(stack, { reference: null });
    await stack.processor.process(job(id));
    const row = stack.db.verifications.find((v) => v.id === id);
    expect(row?.state).toBe(VerificationState.INCONCLUSIVE);
    const types = stack.db.outbox.map((o) => o.type).sort();
    expect(types).toEqual(['verification_completed', 'verification_flagged']);
  });

  it('deleted video → FAILED (VIDEO_UNAVAILABLE), no loop, emits nothing', async () => {
    const id = await toUploaded(stack);
    stack.storage.objects.clear(); // video gone (retention/tombstone)
    await stack.processor.process(job(id));
    const row = stack.db.verifications.find((v) => v.id === id);
    expect(row?.state).toBe(VerificationState.FAILED);
    expect(row?.failure_reason).toBe('VIDEO_UNAVAILABLE');
    expect(stack.db.outbox).toHaveLength(0);
    expect(stack.queue.jobs).toHaveLength(0);
  });

  it('AI timeout → FAILED (AI_TIMEOUT), emits nothing', async () => {
    const id = await toUploaded(stack);
    stack.faceVerify.next = new FaceVerifyTimeoutError();
    await stack.processor.process(job(id));
    const row = stack.db.verifications.find((v) => v.id === id);
    expect(row?.state).toBe(VerificationState.FAILED);
    expect(row?.failure_reason).toBe('AI_TIMEOUT');
    expect(stack.db.outbox).toHaveLength(0);
  });

  it('AI unavailable → FAILED (AI_UNAVAILABLE)', async () => {
    const id = await toUploaded(stack);
    stack.faceVerify.next = new Error('connection refused');
    await stack.processor.process(job(id));
    const row = stack.db.verifications.find((v) => v.id === id);
    expect(row?.state).toBe(VerificationState.FAILED);
    expect(row?.failure_reason).toBe('AI_UNAVAILABLE');
  });

  it('beginProcessing loser (not UPLOADED) is a no-op without side effects', async () => {
    const id = await toUploaded(stack);
    const row = stack.db.verifications.find((v) => v.id === id);
    if (row) {
      row.state = VerificationState.MATCH; // already terminal
    }
    await stack.processor.process(job(id));
    expect(stack.db.verifications.find((v) => v.id === id)?.state).toBe(VerificationState.MATCH);
    expect(stack.db.outbox).toHaveLength(0);
  });

  it('a stale (older) attempt result is discarded by the latest-attempt guard', async () => {
    const id = await toUploaded(stack);
    // Simulate a newer attempt already claimed after this job began.
    await stack.repository.beginProcessing(id); // attempt = 1 (winner of this run)
    const row = stack.db.verifications.find((v) => v.id === id);
    if (row) {
      row.processing_attempt = 5; // a newer attempt superseded this one
    }
    const applied = await stack.repository.writeResultGuarded(
      id,
      1,
      VerificationState.MATCH,
      { decision: Decision.MATCH, matchScore: 0.9 },
      [],
    );
    expect(applied).toBe(false);
    expect(stack.db.verifications.find((v) => v.id === id)?.state).toBe(VerificationState.PROCESSING);
  });
});
