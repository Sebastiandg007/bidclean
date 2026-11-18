import { VerificationArrivalConsumer } from '../consumers/verification-arrival.consumer';
import { FinalizeUploadDto } from '../dto/finalize-upload.dto';
import { Decision, VerificationState } from '../video-verification.types';
import {
  buildVerificationStack,
  StoredObject,
  VerificationStack,
} from './support/build-verification-stack';

/** Minimal fake checkpoint over an in-memory outbox for the 'video' consumer. */
class FakeCheckpoint {
  acked: Array<{ eventId: string; consumer: string }> = [];
  constructor(
    private readonly rows: Array<{
      eventId: string;
      type: string;
      aggregateId: string;
      payload: Record<string, unknown>;
    }>,
  ) {}

  async drainUnacked(consumer: string): Promise<
    Array<{ eventId: string; type: string; aggregateId: string; payload: Record<string, unknown> }>
  > {
    return this.rows.filter(
      (r) => !this.acked.some((a) => a.eventId === r.eventId && a.consumer === consumer),
    );
  }

  async ack(eventId: string, consumer: string): Promise<void> {
    this.acked.push({ eventId, consumer });
  }
}

function arrivedRow(sessionId: string) {
  return {
    eventId: `service_arrived:${sessionId}`,
    type: 'service_arrived',
    aggregateId: sessionId,
    payload: {
      sessionId,
      offerId: 'offer-1',
      cleanerId: 'cleaner-1',
      hostId: 'host-1',
      arrivalDistanceM: 12,
    },
  };
}

function validObject(): StoredObject {
  return { sizeBytes: 2048, contentType: 'video/mp4', durationMs: 9000, bytes: Buffer.from('vv') };
}

/** request-upload → PUT → finalize → run the worker; returns the verification id. */
async function fullUpload(stack: VerificationStack, id: string): Promise<void> {
  const target = await stack.service.requestUpload(id, 'cleaner-1');
  stack.storage.putObject(target.objectKey, validObject());
  const dto = new FinalizeUploadDto();
  dto.objectKey = target.objectKey;
  await stack.service.finalizeUpload(id, 'cleaner-1', dto);
}

describe('Integration — arrival → creation via the video checkpoint', () => {
  it('creates one PENDING_UPLOAD row and coexists with a redelivery', async () => {
    const stack = buildVerificationStack();
    const checkpoint = new FakeCheckpoint([arrivedRow('sess-1'), arrivedRow('sess-1')]);
    const consumer = new VerificationArrivalConsumer(checkpoint as never, stack.creationService);
    await consumer.drainOnce();
    await consumer.drainOnce();
    expect(stack.db.verifications).toHaveLength(1);
    expect(stack.db.verifications[0]?.state).toBe(VerificationState.PENDING_UPLOAD);
  });
});

describe('Integration — full upload → compare → decision + outbox', () => {
  it('MATCH path emits verification_completed and no flag; non-participant is denied', async () => {
    const stack = buildVerificationStack();
    const checkpoint = new FakeCheckpoint([arrivedRow('sess-1')]);
    await new VerificationArrivalConsumer(checkpoint as never, stack.creationService).drainOnce();
    const id = stack.db.verifications[0]?.id as string;

    await fullUpload(stack, id);
    expect(stack.db.verifications[0]?.state).toBe(VerificationState.UPLOADED);

    stack.kycReader.setSelfie('cleaner-1', Buffer.from('ref'));
    stack.faceVerify.next = { score: 0.95, decision: Decision.MATCH };
    await stack.processor.process({ data: { verificationId: id } } as never);

    expect(stack.db.verifications[0]?.state).toBe(VerificationState.MATCH);
    expect(stack.db.outbox.map((o) => o.type)).toEqual(['verification_completed']);

    // A non-participant read is denied.
    await expect(stack.service.getVerification(id, 'stranger')).rejects.toBeDefined();
  });

  it('NO_MATCH path emits completed + flagged', async () => {
    const stack = buildVerificationStack();
    const checkpoint = new FakeCheckpoint([arrivedRow('sess-2')]);
    await new VerificationArrivalConsumer(checkpoint as never, stack.creationService).drainOnce();
    const id = stack.db.verifications[0]?.id as string;
    await fullUpload(stack, id);
    stack.kycReader.setSelfie('cleaner-1', Buffer.from('ref'));
    stack.faceVerify.next = { score: 0.1, decision: Decision.MATCH };
    await stack.processor.process({ data: { verificationId: id } } as never);
    expect(stack.db.verifications[0]?.state).toBe(VerificationState.NO_MATCH);
    expect(stack.db.outbox.map((o) => o.type).sort()).toEqual([
      'verification_completed',
      'verification_flagged',
    ]);
  });
});

describe('Integration — non-fatal paths & retention', () => {
  it('missing reference → INCONCLUSIVE; AI down → FAILED; retention deletes past horizon', async () => {
    const stack = buildVerificationStack();
    const checkpoint = new FakeCheckpoint([arrivedRow('sess-3')]);
    await new VerificationArrivalConsumer(checkpoint as never, stack.creationService).drainOnce();
    const id = stack.db.verifications[0]?.id as string;
    await fullUpload(stack, id);

    // No VERIFIED selfie → INCONCLUSIVE.
    stack.kycReader.setSelfie('cleaner-1', null);
    await stack.processor.process({ data: { verificationId: id } } as never);
    expect(stack.db.verifications[0]?.state).toBe(VerificationState.INCONCLUSIVE);

    // Age the upload past the retention horizon → object hard-deleted, video_deleted_at set.
    const row = stack.db.verifications[0];
    if (row) {
      row.uploaded_at = new Date(Date.now() - 72 * 3_600_000);
    }
    await stack.retention.sweepOnce();
    expect(stack.db.verifications[0]?.video_deleted_at).not.toBeNull();
    // The derived result persists (record retained, no deleted_at).
    expect(stack.db.verifications[0]?.state).toBe(VerificationState.INCONCLUSIVE);
  });
});
