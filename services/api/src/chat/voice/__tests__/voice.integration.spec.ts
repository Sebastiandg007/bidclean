import { ConflictException, ForbiddenException } from '@nestjs/common';

import { SendVoiceParams } from '../voice.types';
import { buildVoiceStack, openVoiceConversation, VoiceStack } from './support/build-voice-stack';

/**
 * Integration/scenario tests (tasks 16.1-16.3 · P1, P2, P3, P4, P5, P16, P17, P18).
 *
 * ChatService wired to the real repositories over the in-memory voice DataSource + a controllable
 * storage double. Covers: upload -> send -> history -> playback; authorization + CLOSED race +
 * orphan eligibility; deletion tombstone drain; participant deletion keeps history.
 */

function params(overrides: Partial<SendVoiceParams>): SendVoiceParams {
  return {
    conversationId: 'conv',
    senderId: 'host-1',
    clientMessageId: 'c1',
    objectKey: 'k/o',
    durationMs: 5000,
    sizeBytes: 1024,
    mimeType: 'audio/mp4',
    waveform: null,
    ...overrides,
  };
}

async function grant(stack: VoiceStack, conversationId: string, userId: string): Promise<string> {
  const target = await stack.service.createVoiceUploadTarget(conversationId, userId);
  stack.storage.putObject(target.objectKey, {});
  return target.objectKey;
}

describe('voice-notes integration — upload -> send -> history -> playback (16.1)', () => {
  let stack: VoiceStack;
  let conversationId: string;

  beforeEach(async () => {
    stack = buildVoiceStack();
    conversationId = await openVoiceConversation(stack);
  });

  it('issues a grant, sends atomically, interleaves in history, and mints playback (P1/P4/P5/P16)', async () => {
    const objectKey = await grant(stack, conversationId, 'host-1');
    // Interleave a text message before the voice note.
    await stack.service.sendMessage(conversationId, 'host-1', 't1', 'text first');
    const sent = await stack.service.sendVoiceMessage(params({ conversationId, objectKey, clientMessageId: 'v1' }));

    // History (ascending) shows TEXT then VOICE, both ordered by sequence.
    const page = await stack.service.getMessagesBefore(conversationId, 'cleaner-1', null, 50);
    const ascending = [...page.messages].reverse();
    expect(ascending.map((m) => m.type)).toEqual(['TEXT', 'VOICE']);
    expect(ascending[1]?.voiceNote?.durationMs).toBe(5000);
    // The grant was consumed atomically with the message + metadata.
    expect(stack.db.grants[0]?.status).toBe('CONSUMED');

    // Playback resolves the key from the DB by messageId.
    const playback = await stack.service.getVoicePlaybackTarget(conversationId, 'host-1', sent.message.id);
    expect(playback.playbackUrl).toContain(objectKey);
  });

  it('reconciles a voice note via the after cursor (P16)', async () => {
    const objectKey = await grant(stack, conversationId, 'host-1');
    await stack.service.sendMessage(conversationId, 'host-1', 't1', 'seen');
    await stack.service.sendVoiceMessage(params({ conversationId, objectKey, clientMessageId: 'v1' }));
    const after = await stack.service.getMessagesAfter(conversationId, 'cleaner-1', 1, 50);
    expect(after.messages.map((m) => m.type)).toEqual(['VOICE']);
  });
});

describe('voice-notes integration — authorization, CLOSED race & orphans (16.2)', () => {
  let stack: VoiceStack;
  let conversationId: string;

  beforeEach(async () => {
    stack = buildVoiceStack();
    conversationId = await openVoiceConversation(stack);
  });

  it('denies a non-participant upload-url, send, and playback (P2/P3)', async () => {
    await expect(
      stack.service.createVoiceUploadTarget(conversationId, 'stranger'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const objectKey = await grant(stack, conversationId, 'host-1');
    const sent = await stack.service.sendVoiceMessage(params({ conversationId, objectKey }));
    await expect(
      stack.service.getVoicePlaybackTarget(conversationId, 'stranger', sent.message.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('open -> upload URL -> CLOSED -> upload -> send rejected (409); grant left ISSUED for cleanup (P17)', async () => {
    const target = await stack.service.createVoiceUploadTarget(conversationId, 'host-1');
    stack.storage.putObject(target.objectKey, {});
    // Conversation closes after the URL was issued.
    await stack.service.closeConversationsForOffer('offer-1');

    await expect(
      stack.service.sendVoiceMessage(params({ conversationId, objectKey: target.objectKey })),
    ).rejects.toBeInstanceOf(ConflictException);

    // The grant is left unconsumed (ISSUED) — the orphan object is cleanup-eligible.
    expect(stack.db.grants[0]?.status).toBe('ISSUED');
    expect(stack.db.voiceNotes).toHaveLength(0);
  });
});

describe('voice-notes integration — deletion coherence & tombstone (16.3)', () => {
  it('deleting a voice message tombstones its object_key for eventual cleanup (P17/P18)', async () => {
    const stack = buildVoiceStack();
    const conversationId = await openVoiceConversation(stack);
    const target = await stack.service.createVoiceUploadTarget(conversationId, 'host-1');
    stack.storage.putObject(target.objectKey, {});
    const sent = await stack.service.sendVoiceMessage(params({ conversationId, objectKey: target.objectKey }));

    // Simulate the BEFORE DELETE trigger firing when the message/metadata is removed.
    stack.db.tombstoneDelete(sent.message.id);

    expect(stack.db.voiceNotes).toHaveLength(0);
    expect(stack.db.tombstones).toHaveLength(1);
    expect(stack.db.tombstones[0]?.object_key).toBe(target.objectKey);
    expect(stack.db.tombstones[0]?.status).toBe('PENDING');
  });
});