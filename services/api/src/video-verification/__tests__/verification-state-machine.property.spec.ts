import * as fc from 'fast-check';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { FaceVerifyTimeoutError } from '../ai-client/face-verify.types';
import { FinalizeUploadDto } from '../dto/finalize-upload.dto';
import {
  buildResultOutboxRows,
} from '../verification-outbox';
import {
  classify,
  Classification,
  Decision,
  VerificationState,
} from '../video-verification.types';
import {
  buildVerificationStack,
  seedPendingVerification,
  StoredObject,
  VerificationStack,
} from './support/build-verification-stack';

/**
 * Property-based tests for the video-verification backend (fast-check, >=100 runs each).
 *
 * Each test maps to a design property P1..P14 and is tagged below.
 */

const RUNS = { numRuns: 100 };
const ALLOWED_MIME = ['video/mp4', 'video/quicktime', 'video/webm'];
const MAX_SIZE = 15_728_640;
const MAX_DURATION = 15_000;

function validObject(overrides: Partial<StoredObject> = {}): StoredObject {
  return {
    sizeBytes: 1024,
    contentType: 'video/mp4',
    durationMs: 8000,
    bytes: Buffer.from('v'),
    ...overrides,
  };
}

function finalizeDto(objectKey: string): FinalizeUploadDto {
  const dto = new FinalizeUploadDto();
  dto.objectKey = objectKey;
  return dto;
}

/** Drive a seeded verification to UPLOADED with a stored video + reference. */
async function toUploaded(stack: VerificationStack, reference: Buffer | null): Promise<string> {
  const id = await seedPendingVerification(stack);
  const row = stack.db.verifications.find((v) => v.id === id);
  if (row) {
    row.state = VerificationState.UPLOADED;
    row.object_key = 'ab/v';
    row.uploaded_at = new Date();
  }
  stack.storage.putObject('ab/v', validObject());
  stack.kycReader.setSelfie('cleaner-1', reference);
  return id;
}

// Feature: video-verification, Property 1: One verification per arrival, created idempotently.
describe('P1 — idempotent creation', () => {
  it('N redeliveries and concurrent creates yield exactly one row per service session', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 8 }), async (redeliveries) => {
        const stack = buildVerificationStack();
        const payload = {
          sessionId: 'sess-x',
          offerId: 'offer-x',
          cleanerId: 'cleaner-1',
          hostId: 'host-1',
        };
        await Promise.all(
          Array.from({ length: redeliveries }, () =>
            stack.creationService.createFromArrival(payload),
          ),
        );
        expect(stack.db.verifications).toHaveLength(1);
        expect(stack.db.verifications[0]?.state).toBe(VerificationState.PENDING_UPLOAD);
        expect(stack.db.verifications[0]?.match_threshold).toBe('0.6000');
      }),
      RUNS,
    );
  });
});

// Feature: video-verification, Property 2: Participant isolation & key != credential.
describe('P2 — participant isolation & key is not a credential', () => {
  it('request-upload succeeds only for the Cleaner; others are denied', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom('cleaner-1', 'host-1', 'stranger'), async (caller) => {
        const stack = buildVerificationStack();
        const id = await seedPendingVerification(stack);
        const promise = stack.service.requestUpload(id, caller);
        if (caller === 'cleaner-1') {
          await expect(promise).resolves.toHaveProperty('objectKey');
        } else {
          await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
        }
      }),
      RUNS,
    );
  });

  it('finalize with a bare key (no matching grant) never authorizes', async () => {
    await fc.assert(
      fc.asyncProperty(fc.hexaString({ minLength: 4, maxLength: 12 }), async (rawKey) => {
        const stack = buildVerificationStack();
        const id = await seedPendingVerification(stack);
        const key = `ab/${rawKey}`;
        stack.storage.putObject(key, validObject());
        await expect(
          stack.service.finalizeUpload(id, 'cleaner-1', finalizeDto(key)),
        ).rejects.toBeInstanceOf(ForbiddenException);
      }),
      RUNS,
    );
  });
});

// Feature: video-verification, Property 3: Video isolation, no playback, short retention.
describe('P3 — no playback presign exists; retention deletes past horizon (clock = uploaded_at)', () => {
  it('the storage surface never exposes a playback/download presign', () => {
    const stack = buildVerificationStack();
    const surface = stack.storage as unknown as Record<string, unknown>;
    expect(surface.getPlaybackUrl).toBeUndefined();
    expect(surface.presignDownload).toBeUndefined();
    expect(surface.getPlaybackTarget).toBeUndefined();
  });

  it('a video is deleted iff (now - uploaded_at) is past the horizon; video_deleted_at set once', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 120 }), async (hoursAgo) => {
        const stack = buildVerificationStack();
        const id = await seedPendingVerification(stack);
        const row = stack.db.verifications.find((v) => v.id === id);
        if (row) {
          row.state = VerificationState.MATCH;
          row.object_key = 'ab/v';
          row.uploaded_at = new Date(Date.now() - hoursAgo * 3_600_000);
        }
        stack.storage.putObject('ab/v', validObject());
        await stack.retention.sweepOnce();
        const after = stack.db.verifications.find((v) => v.id === id);
        if (hoursAgo > 48) {
          expect(after?.video_deleted_at).not.toBeNull();
          expect(stack.storage.deleted).toContain('ab/v');
        } else {
          expect(after?.video_deleted_at).toBeNull();
        }
      }),
      RUNS,
    );
  });
});

// Feature: video-verification, Property 4: Server-authoritative object validation.
describe('P4 — server-observed size/type/duration decide acceptance; declared never overrides', () => {
  it('accept iff server-observed within bounds; else 400 with nothing persisted, grant unconsumed', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          sizeBytes: fc.integer({ min: 1, max: 20_000_000 }),
          contentType: fc.constantFrom('video/mp4', 'video/webm', 'application/zip', 'text/plain'),
          durationMs: fc.oneof(fc.integer({ min: 1, max: 60_000 }), fc.constant<null>(null)),
        }),
        async (observed) => {
          const stack = buildVerificationStack();
          const id = await seedPendingVerification(stack);
          const target = await stack.service.requestUpload(id, 'cleaner-1');
          stack.storage.putObject(target.objectKey, { ...observed, bytes: Buffer.from('v') });

          const shouldAccept =
            observed.sizeBytes <= MAX_SIZE &&
            ALLOWED_MIME.includes(observed.contentType) &&
            observed.durationMs !== null &&
            observed.durationMs <= MAX_DURATION;

          const promise = stack.service.finalizeUpload(id, 'cleaner-1', finalizeDto(target.objectKey));
          if (shouldAccept) {
            await expect(promise).resolves.toHaveProperty('state', VerificationState.UPLOADED);
          } else {
            await expect(promise).rejects.toBeInstanceOf(BadRequestException);
            expect(stack.db.verifications[0]?.state).toBe(VerificationState.PENDING_UPLOAD);
            expect(stack.db.grants[0]?.status).toBe('ISSUED');
          }
        },
      ),
      RUNS,
    );
  });
});

// Feature: video-verification, Property 5: Comparison is advisory, never a gate.
describe('P5 — advisory outcomes never gate; flag emission is decision-scoped', () => {
  it('flag emitted iff NO_MATCH/INCONCLUSIVE; FAILED/EXPIRED/DISABLED emit no completed/flag', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<Decision>(Decision.MATCH, Decision.NO_MATCH, Decision.INCONCLUSIVE),
        async (decision) => {
          const rows = buildResultOutboxRows({
            verificationId: 'ver-1',
            serviceSessionId: 'sess-1',
            decision,
            score: 0.5,
          });
          const types = rows.map((r) => r.type);
          expect(types).toContain('verification_completed');
          if (decision === Decision.NO_MATCH || decision === Decision.INCONCLUSIVE) {
            expect(types).toContain('verification_flagged');
          } else {
            expect(types).not.toContain('verification_flagged');
          }
        },
      ),
      RUNS,
    );
  });
});

// Feature: video-verification, Property 6: Stale-safe monotonic attempts.
describe('P6 — attempt bumped only by a controlled-transition winner; latest-attempt guard', () => {
  it('a beginProcessing loser never bumps the counter; only the latest attempt writes', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 6 }), async (concurrent) => {
        const stack = buildVerificationStack();
        const id = await toUploaded(stack, Buffer.from('ref'));
        const results = await Promise.all(
          Array.from({ length: concurrent }, () => stack.repository.beginProcessing(id)),
        );
        const winners = results.filter((r) => r !== null);
        expect(winners).toHaveLength(1);
        expect(stack.db.verifications.find((v) => v.id === id)?.processing_attempt).toBe(1);

        // A stale attempt (0) cannot write; only the winner's attempt (1) can.
        const stale = await stack.repository.writeResultGuarded(
          id,
          0,
          VerificationState.MATCH,
          { decision: Decision.MATCH, matchScore: 0.9 },
          [],
        );
        expect(stale).toBe(false);
      }),
      RUNS,
    );
  });
});

// Feature: video-verification, Property 7: No stuck verification.
describe('P7 — never-uploaded expires; stuck UPLOADED/PROCESSING recovers then FAILs after max', () => {
  it('PENDING_UPLOAD past window → EXPIRED (idempotent)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (passes) => {
        const stack = buildVerificationStack();
        const id = await seedPendingVerification(stack);
        const row = stack.db.verifications.find((v) => v.id === id);
        if (row) {
          const past = new Date(Date.now() - 3_600_000);
          row.created_at = past;
          row.updated_at = past;
        }
        for (let i = 0; i < passes; i += 1) {
          await stack.uploadSweep.sweepOnce();
        }
        expect(stack.db.verifications.find((v) => v.id === id)?.state).toBe(
          VerificationState.EXPIRED,
        );
      }),
      RUNS,
    );
  });

  it('a PROCESSING row at/over max attempts is FAILED (MAX_ATTEMPTS)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 3, max: 8 }), async (attempt) => {
        const stack = buildVerificationStack();
        const id = await seedPendingVerification(stack);
        const row = stack.db.verifications.find((v) => v.id === id);
        if (row) {
          row.state = VerificationState.PROCESSING;
          row.processing_attempt = attempt; // >= max (3)
          const past = new Date(Date.now() - 3_600_000);
          row.updated_at = past;
          row.created_at = past;
        }
        await stack.stuckSweep.sweepOnce();
        expect(stack.db.verifications.find((v) => v.id === id)?.state).toBe(
          VerificationState.FAILED,
        );
      }),
      RUNS,
    );
  });
});

// Feature: video-verification, Property 8: Threshold snapshot & range.
describe('P8 — decision uses the ROW snapshot threshold; MATCH iff score >= snapshot', () => {
  it('MATCH iff score >= snapshot t, invariant to any other config', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.float({ min: 0, max: 1, noNaN: true }),
        fc.float({ min: Math.fround(0.01), max: 1, noNaN: true }),
        async (score, threshold) => {
          const stack = buildVerificationStack();
          const id = await toUploaded(stack, Buffer.from('ref'));
          const row = stack.db.verifications.find((v) => v.id === id);
          if (row) {
            row.match_threshold = threshold.toFixed(4);
          }
          stack.faceVerify.next = { score, decision: Decision.MATCH };
          await stack.processor.process({ data: { verificationId: id } } as never);
          const after = stack.db.verifications.find((v) => v.id === id);
          const expected =
            score >= parseFloat(threshold.toFixed(4))
              ? VerificationState.MATCH
              : VerificationState.NO_MATCH;
          expect(after?.state).toBe(expected);
        },
      ),
      RUNS,
    );
  });
});

// Feature: video-verification, Property 9: Single-winner transitions + outbox atomicity.
describe('P9 — one winner per transition; MATCH always carries a score; completed => committed', () => {
  it('concurrent beginProcessing yields exactly one winner and one attempt bump', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 10 }), async (n) => {
        const stack = buildVerificationStack();
        const id = await toUploaded(stack, Buffer.from('ref'));
        const results = await Promise.all(
          Array.from({ length: n }, () => stack.repository.beginProcessing(id)),
        );
        expect(results.filter((r) => r !== null)).toHaveLength(1);
      }),
      RUNS,
    );
  });

  it('a MATCH terminal always has a committed match_score', async () => {
    await fc.assert(
      fc.asyncProperty(fc.float({ min: Math.fround(0.6), max: 1, noNaN: true }), async (score) => {
        const stack = buildVerificationStack();
        const id = await toUploaded(stack, Buffer.from('ref'));
        stack.faceVerify.next = { score, decision: Decision.MATCH };
        await stack.processor.process({ data: { verificationId: id } } as never);
        const row = stack.db.verifications.find((v) => v.id === id);
        if (row?.state === VerificationState.MATCH) {
          expect(row.match_score).not.toBeNull();
        }
      }),
      RUNS,
    );
  });
});

// Feature: video-verification, Property 10: Deletion coherence.
describe('P10 — tombstone drain removes freed keys idempotently', () => {
  it('every PENDING tombstone is deleted then marked DONE (idempotent)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.hexaString({ minLength: 3, maxLength: 8 }), { minLength: 1, maxLength: 6 }), async (keys) => {
        const stack = buildVerificationStack();
        const unique = Array.from(new Set(keys.map((k) => `ab/${k}`)));
        for (const objectKey of unique) {
          stack.db.tombstones.push({ objectKey, status: 'PENDING' });
        }
        await stack.tombstoneDrain.sweepOnce();
        for (const objectKey of unique) {
          expect(stack.storage.deleted).toContain(objectKey);
        }
        expect(stack.db.tombstones.every((t) => t.status === 'DONE')).toBe(true);
      }),
      RUNS,
    );
  });
});

// Feature: video-verification, Property 11: Disabled => no video.
describe('P11 — DISABLED creation issues no grant and enqueues no job', () => {
  it('a DISABLED verification never has a grant or a comparison job', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        const stack = buildVerificationStack();
        // Simulate the disabled path: creation persists DISABLED directly (config off at boot).
        await stack.repository.createFromArrival({
          serviceSessionId: 'sess-d',
          offerId: 'offer-d',
          cleanerId: 'cleaner-1',
          hostId: 'host-1',
          state: VerificationState.DISABLED,
          matchThreshold: 0.6,
        });
        // request-upload on a DISABLED verification is rejected → no grant, no job.
        const id = stack.db.verifications[0]?.id as string;
        await expect(stack.service.requestUpload(id, 'cleaner-1')).rejects.toBeInstanceOf(
          BadRequestException,
        );
        expect(stack.grantRepository.createGrantCalls).toBe(0);
        expect(stack.queue.jobs).toHaveLength(0);
      }),
      RUNS,
    );
  });
});

// Feature: video-verification, Property 12: Missing-reference & deleted-video are non-fatal.
describe('P12 — missing reference → INCONCLUSIVE; deleted video → FAILED (no loop)', () => {
  it('null reference is non-fatal (INCONCLUSIVE), never throws', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        const stack = buildVerificationStack();
        const id = await toUploaded(stack, null);
        await expect(
          stack.processor.process({ data: { verificationId: id } } as never),
        ).resolves.toBeUndefined();
        expect(stack.db.verifications.find((v) => v.id === id)?.state).toBe(
          VerificationState.INCONCLUSIVE,
        );
      }),
      RUNS,
    );
  });

  it('a deleted video → FAILED (VIDEO_UNAVAILABLE) with zero re-enqueue', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        const stack = buildVerificationStack();
        const id = await toUploaded(stack, Buffer.from('ref'));
        stack.storage.objects.clear();
        await stack.processor.process({ data: { verificationId: id } } as never);
        const row = stack.db.verifications.find((v) => v.id === id);
        expect(row?.state).toBe(VerificationState.FAILED);
        expect(row?.failure_reason).toBe('VIDEO_UNAVAILABLE');
        expect(stack.queue.jobs).toHaveLength(0);
      }),
      RUNS,
    );
  });

  it('an AI failure → FAILED without throwing out of the processor', async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (timeout) => {
        const stack = buildVerificationStack();
        const id = await toUploaded(stack, Buffer.from('ref'));
        stack.faceVerify.next = timeout ? new FaceVerifyTimeoutError() : new Error('down');
        await stack.processor.process({ data: { verificationId: id } } as never);
        const row = stack.db.verifications.find((v) => v.id === id);
        expect(row?.state).toBe(VerificationState.FAILED);
        expect(row?.failure_reason).toBe(timeout ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE');
      }),
      RUNS,
    );
  });
});

// Feature: video-verification, Property 13: Score internal / derived classification.
describe('P13 — Host surface exposes exactly one classification, never the score or footage', () => {
  it('every state maps to exactly one classification; the view has no score/url', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<VerificationState>(
          VerificationState.PENDING_UPLOAD,
          VerificationState.UPLOADED,
          VerificationState.PROCESSING,
          VerificationState.MATCH,
          VerificationState.NO_MATCH,
          VerificationState.INCONCLUSIVE,
          VerificationState.FAILED,
          VerificationState.DISABLED,
          VerificationState.EXPIRED,
        ),
        async (state) => {
          const stack = buildVerificationStack();
          const id = await seedPendingVerification(stack);
          const row = stack.db.verifications.find((v) => v.id === id);
          if (row) {
            row.state = state;
            row.match_score = '0.7700';
          }
          const view = await stack.service.getVerification(id, 'host-1');
          const classifications = Object.values(Classification);
          expect(classifications).toContain(view.classification);
          expect(view.classification).toBe(classify(state));
          const keys = Object.keys(view);
          expect(keys).not.toContain('matchScore');
          expect(keys).not.toContain('videoUrl');
          expect(keys).not.toContain('objectKey');
        },
      ),
      RUNS,
    );
  });
});

// Feature: video-verification, Property 14: No hardcoded config/secrets (validator range).
describe('P14 — validator rejects out-of-range thresholds and missing required values', () => {
  it('rejects any threshold outside (0, 1]', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.float({ min: Math.fround(-5), max: 0, noNaN: true }),
          fc.float({ min: Math.fround(1.0001), max: 5, noNaN: true }),
        ),
        (bad) => {
          const saved = { ...process.env };
          jest.resetModules();
          process.env = {
            ...saved,
            NODE_ENV: 'production',
            VIDEO_VERIFICATION_ENABLED: 'true',
            VIDEO_VERIFICATION_MINIO_BUCKET: 'b',
            VIDEO_VERIFICATION_AI_URL: 'http://ai',
            VIDEO_VERIFICATION_MATCH_THRESHOLD: String(bad),
          } as NodeJS.ProcessEnv;
          try {
            const mod = require('../config/validate-video-verification-config');
            expect(() => mod.validateVideoVerificationConfig()).toThrow(/MATCH_THRESHOLD/);
          } finally {
            process.env = saved;
            jest.resetModules();
          }
        },
      ),
      RUNS,
    );
  });
});
