import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';

import { SendVoiceParams } from '../voice.types';
import { buildVoiceStack, openVoiceConversation, VoiceStack } from './support/build-voice-stack';

/**
 * Unit tests for ChatService.sendVoiceMessage (task 5.2 · P1, P2, P5, P6, P7, P8, P9, P11).
 *
 * Exercises the full serialized send over the in-memory voice DataSource + a controllable storage
 * double: grant scoping, fingerprint idempotency, authoritative bounds, atomic message+metadata+
 * grant-consume, and best-effort publish/enqueue.
 */

async function issueGrantAndUpload(
  stack: VoiceStack,
  conversationId: string,
  userId: string,
  observed: Partial<{ sizeBytes: number; contentType: string; durationMs: number | null }> = {},
): Promise<string> {
  const target = await stack.service.createVoiceUploadTarget(conversationId, userId);
  stack.storage.putObject(target.objectKey, observed);
  return target.objectKey;
}

function sendParams(overrides: Partial<SendVoiceParams>): SendVoiceParams {
  return {
    conversationId: 'conv',
    senderId: 'host-1',
    clientMessageId: 'c1',
    objectKey: 'k1/object',
    durationMs: 5000,
    sizeBytes: 1024,
    mimeType: 'audio/mp4',
    waveform: null,
    ...overrides,
  };
}

describe('ChatService.sendVoiceMessage', () => {
  let stack: VoiceStack;
  let conversationId: string;

  beforeEach(async () => {
    stack = buildVoiceStack();
    conversationId = await openVoiceConversation(stack);
  });

  it('persists a VOICE message + metadata, consumes the grant, publishes, enqueues (P1/P5)', async () => {
    const objectKey = await issueGrantAndUpload(stack, conversationId, 'host-1');
    const result = await stack.service.sendVoiceMessage(
      sendParams({ conversationId, objectKey }),
    );

    expect(result.deduplicated).toBe(false);
    expect(result.message.type).toBe('VOICE');
    expect(result.message.body).toBeNull();
    expect(result.message.voiceNote?.durationMs).toBe(5000);
    // Metadata row persisted, grant consumed, publish + enqueue fired.
    expect(stack.db.voiceNotes).toHaveLength(1);
    expect(stack.db.grants[0]?.status).toBe('CONSUMED');
    expect(stack.db.grants[0]?.consumed_message_id).toBe(result.message.id);
    expect(stack.publisher.publish).toHaveBeenCalledTimes(1);
    expect(stack.enqueuer.add).toHaveBeenCalledTimes(1);
  });

  it('persists the SERVER-OBSERVED size/duration/mime, not the declared values (P8)', async () => {
    const objectKey = await issueGrantAndUpload(stack, conversationId, 'host-1', {
      sizeBytes: 2048,
      contentType: 'audio/mpeg',
      durationMs: 8000,
    });
    const result = await stack.service.sendVoiceMessage(
      // Declared values differ from the stored object; server-observed must win.
      sendParams({ conversationId, objectKey, sizeBytes: 1, durationMs: 1, mimeType: 'audio/mp4' }),
    );
    expect(result.message.voiceNote?.sizeBytes).toBe(2048);
    expect(result.message.voiceNote?.durationMs).toBe(8000);
    expect(result.message.voiceNote?.mimeType).toBe('audio/mpeg');
  });

  it('rejects a send whose object key was granted to another user (P2)', async () => {
    // Grant issued to the cleaner; the host tries to use its key.
    const target = await stack.service.createVoiceUploadTarget(conversationId, 'cleaner-1');
    stack.storage.putObject(target.objectKey, {});
    await expect(
      stack.service.sendVoiceMessage(
        sendParams({ conversationId, objectKey: target.objectKey, senderId: 'host-1' }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(stack.db.voiceNotes).toHaveLength(0);
  });

  it('rejects a send with an unknown object key — possession is never authorization (P2)', async () => {
    stack.storage.putObject('forged/key', {});
    await expect(
      stack.service.sendVoiceMessage(
        sendParams({ conversationId, objectKey: 'forged/key', senderId: 'host-1' }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns the existing message for an identical retry; conflicts on a changed fingerprint (P7)', async () => {
    const objectKey = await issueGrantAndUpload(stack, conversationId, 'host-1');
    const first = await stack.service.sendVoiceMessage(
      sendParams({ conversationId, objectKey, clientMessageId: 'cid' }),
    );
    const retry = await stack.service.sendVoiceMessage(
      sendParams({ conversationId, objectKey, clientMessageId: 'cid' }),
    );
    expect(retry.deduplicated).toBe(true);
    expect(retry.message.id).toBe(first.message.id);
    expect(stack.db.voiceNotes).toHaveLength(1);

    // Same clientMessageId, different fingerprint (waveform) → 409.
    await expect(
      stack.service.sendVoiceMessage(
        sendParams({ conversationId, objectKey, clientMessageId: 'cid', waveform: [1, 2, 3] }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects reuse of a consumed grant — a grant maps to at most one message (P6)', async () => {
    const objectKey = await issueGrantAndUpload(stack, conversationId, 'host-1');
    await stack.service.sendVoiceMessage(
      sendParams({ conversationId, objectKey, clientMessageId: 'c1' }),
    );
    // A brand-new clientMessageId reusing the now-CONSUMED grant is rejected.
    await expect(
      stack.service.sendVoiceMessage(
        sendParams({ conversationId, objectKey, clientMessageId: 'c2' }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(stack.db.voiceNotes).toHaveLength(1);
  });

  it('rejects an oversized object with 400 and persists nothing (P8)', async () => {
    const objectKey = await issueGrantAndUpload(stack, conversationId, 'host-1', {
      sizeBytes: 999_999_999,
    });
    await expect(
      stack.service.sendVoiceMessage(sendParams({ conversationId, objectKey })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(stack.db.voiceNotes).toHaveLength(0);
    expect(stack.db.grants[0]?.status).toBe('ISSUED');
  });

  it('rejects a disallowed content type with 400 (P8)', async () => {
    const objectKey = await issueGrantAndUpload(stack, conversationId, 'host-1', {
      contentType: 'application/zip',
    });
    await expect(
      stack.service.sendVoiceMessage(sendParams({ conversationId, objectKey })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an over-duration or unprobeable object with 400 (P9)', async () => {
    const overKey = await issueGrantAndUpload(stack, conversationId, 'host-1', {
      durationMs: 999_999_999,
    });
    await expect(
      stack.service.sendVoiceMessage(sendParams({ conversationId, objectKey: overKey })),
    ).rejects.toBeInstanceOf(BadRequestException);

    const unprobeableKey = await issueGrantAndUpload(stack, conversationId, 'host-1', {
      durationMs: null,
    });
    await expect(
      stack.service.sendVoiceMessage(
        sendParams({ conversationId, objectKey: unprobeableKey, clientMessageId: 'c9' }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a missing object with 400 (P8)', async () => {
    const target = await stack.service.createVoiceUploadTarget(conversationId, 'host-1');
    // Never uploaded → inspect reports exists=false.
    await expect(
      stack.service.sendVoiceMessage(
        sendParams({ conversationId, objectKey: target.objectKey }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a non-participant sender with 403', async () => {
    const objectKey = await issueGrantAndUpload(stack, conversationId, 'host-1');
    await expect(
      stack.service.sendVoiceMessage(
        sendParams({ conversationId, objectKey, senderId: 'stranger' }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not fail the send when publish or enqueue throws (best-effort)', async () => {
    stack.publisher.publish.mockRejectedValue(new Error('centrifugo down'));
    stack.enqueuer.add.mockRejectedValue(new Error('redis down'));
    const objectKey = await issueGrantAndUpload(stack, conversationId, 'host-1');
    await expect(
      stack.service.sendVoiceMessage(sendParams({ conversationId, objectKey })),
    ).resolves.toMatchObject({ deduplicated: false });
    expect(stack.db.voiceNotes).toHaveLength(1);
  });

  it('resolves the playback URL from the DB by messageId (never a client key)', async () => {
    const objectKey = await issueGrantAndUpload(stack, conversationId, 'host-1');
    const sent = await stack.service.sendVoiceMessage(
      sendParams({ conversationId, objectKey }),
    );
    const playback = await stack.service.getVoicePlaybackTarget(
      conversationId,
      'cleaner-1',
      sent.message.id,
    );
    expect(playback.playbackUrl).toContain(objectKey);
  });
});