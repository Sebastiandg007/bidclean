import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { FinalizeUploadDto } from '../dto/finalize-upload.dto';
import { Classification, VerificationState } from '../video-verification.types';
import {
  buildVerificationStack,
  seedPendingVerification,
  StoredObject,
  VerificationStack,
} from './support/build-verification-stack';

/** A valid stored arrival video (within all server bounds). */
function validObject(): StoredObject {
  return { sizeBytes: 1024, contentType: 'video/mp4', durationMs: 8000, bytes: Buffer.from('v') };
}

/** Request an upload as the Cleaner and PUT a valid object; returns the object key. */
async function requestAndPut(stack: VerificationStack, id: string): Promise<string> {
  const target = await stack.service.requestUpload(id, 'cleaner-1');
  stack.storage.putObject(target.objectKey, validObject());
  return target.objectKey;
}

function finalizeDto(objectKey: string): FinalizeUploadDto {
  const dto = new FinalizeUploadDto();
  dto.objectKey = objectKey;
  return dto;
}

describe('VerificationService — request-upload gating', () => {
  let stack: VerificationStack;

  beforeEach(() => {
    stack = buildVerificationStack();
  });

  it('persists the grant BEFORE minting the pre-signed URL (grant-first ordering)', async () => {
    const id = await seedPendingVerification(stack);
    const target = await stack.service.requestUpload(id, 'cleaner-1');
    expect(stack.grantRepository.createGrantCalls).toBe(1);
    expect(stack.db.grants).toHaveLength(1);
    expect(stack.db.grants[0]?.objectKey).toBe(target.objectKey);
    expect(target.uploadUrl).toContain(target.objectKey);
  });

  it('denies a non-participant (403) and the Host (only the Cleaner may upload)', async () => {
    const id = await seedPendingVerification(stack);
    await expect(stack.service.requestUpload(id, 'stranger')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(stack.service.requestUpload(id, 'host-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects request-upload when not PENDING_UPLOAD (DISABLED/terminal → 409-equivalent)', async () => {
    const id = await seedPendingVerification(stack, { state: VerificationState.DISABLED });
    await expect(stack.service.requestUpload(id, 'cleaner-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(stack.db.grants).toHaveLength(0);
  });
});

describe('VerificationService — finalize (server-authoritative, grant-gated)', () => {
  let stack: VerificationStack;

  beforeEach(() => {
    stack = buildVerificationStack();
  });

  it('accepts a valid object, transitions UPLOADED, consumes the grant, enqueues comparison', async () => {
    const id = await seedPendingVerification(stack);
    const objectKey = await requestAndPut(stack, id);
    const view = await stack.service.finalizeUpload(id, 'cleaner-1', finalizeDto(objectKey));
    expect(view.state).toBe(VerificationState.UPLOADED);
    expect(stack.db.grants[0]?.status).toBe('CONSUMED');
    expect(stack.queue.jobs).toEqual([{ verificationId: id }]);
  });

  it('rejects an over-limit object (400) with nothing persisted and grant unconsumed', async () => {
    const id = await seedPendingVerification(stack);
    const target = await stack.service.requestUpload(id, 'cleaner-1');
    stack.storage.putObject(target.objectKey, {
      ...validObject(),
      sizeBytes: 999_999_999,
    });
    await expect(
      stack.service.finalizeUpload(id, 'cleaner-1', finalizeDto(target.objectKey)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(stack.db.verifications[0]?.state).toBe(VerificationState.PENDING_UPLOAD);
    expect(stack.db.grants[0]?.status).toBe('ISSUED');
    expect(stack.queue.jobs).toHaveLength(0);
  });

  it('rejects a wrong content-type object (400)', async () => {
    const id = await seedPendingVerification(stack);
    const target = await stack.service.requestUpload(id, 'cleaner-1');
    stack.storage.putObject(target.objectKey, { ...validObject(), contentType: 'application/zip' });
    await expect(
      stack.service.finalizeUpload(id, 'cleaner-1', finalizeDto(target.objectKey)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unprobeable duration object (400)', async () => {
    const id = await seedPendingVerification(stack);
    const target = await stack.service.requestUpload(id, 'cleaner-1');
    stack.storage.putObject(target.objectKey, { ...validObject(), durationMs: null });
    await expect(
      stack.service.finalizeUpload(id, 'cleaner-1', finalizeDto(target.objectKey)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('possession of a bare object key never authorizes finalize (key ≠ credential)', async () => {
    const id = await seedPendingVerification(stack);
    // A stored object with NO grant persisted: finalize must be rejected.
    stack.storage.putObject('ab/orphan-key', validObject());
    await expect(
      stack.service.finalizeUpload(id, 'cleaner-1', finalizeDto('ab/orphan-key')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects finalize with an expired grant', async () => {
    const id = await seedPendingVerification(stack);
    const objectKey = await requestAndPut(stack, id);
    stack.grantRepository.expire(objectKey);
    await expect(
      stack.service.finalizeUpload(id, 'cleaner-1', finalizeDto(objectKey)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('VerificationService — reconciliation view (score internal)', () => {
  let stack: VerificationStack;

  beforeEach(() => {
    stack = buildVerificationStack();
  });

  it('the GET view exposes only a derived classification, never match_score or a video URL', async () => {
    const id = await seedPendingVerification(stack);
    const view = await stack.service.getVerification(id, 'host-1');
    expect(view.classification).toBe(Classification.UNAVAILABLE);
    expect(Object.keys(view)).not.toContain('matchScore');
    expect(Object.keys(view)).not.toContain('match_score');
    expect(Object.keys(view)).not.toContain('videoUrl');
    expect(Object.keys(view)).not.toContain('objectKey');
  });

  it('a non-participant reconciliation read is denied', async () => {
    const id = await seedPendingVerification(stack);
    await expect(stack.service.getVerification(id, 'stranger')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('a missing verification read is a 404', async () => {
    await expect(stack.service.getVerification('nope', 'host-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('VerificationStorageService fake — no playback presign exists (P3)', () => {
  it('the storage surface has no playback/download method', () => {
    const stack = buildVerificationStack();
    expect((stack.storage as unknown as Record<string, unknown>).getPlaybackUrl).toBeUndefined();
    expect((stack.storage as unknown as Record<string, unknown>).presignDownload).toBeUndefined();
  });
});
