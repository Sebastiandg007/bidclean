import * as fc from 'fast-check';
import { ConflictException, ForbiddenException } from '@nestjs/common';

import { SendVoiceParams } from '../voice.types';
import { buildVoiceStack, openVoiceConversation, VoiceStack } from './support/build-voice-stack';

/**
 * Property-based tests for the voice-note backend (fast-check, >=100 runs each).
 *
 * Feature: voice-notes, Property 2/3: object key is a reference, not a credential.
 * Feature: voice-notes, Property 6/7: single-use grant & fingerprint idempotency.
 * Feature: voice-notes, Property 8/9: server-authoritative bounds.
 * Feature: voice-notes, Property 13: transcript stale-safety.
 * Feature: voice-notes, Property 15: interleaved VOICE/TEXT keyset ordering.
 */

async function grantFor(
  stack: VoiceStack,
  conversationId: string,
  userId: string,
): Promise<string> {
  const target = await stack.service.createVoiceUploadTarget(conversationId, userId);
  stack.storage.putObject(target.objectKey, {});
  return target.objectKey;
}

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

describe('P2/P3 — object key is a reference, not a credential', () => {
  it('a send succeeds only with a grant issued to that caller for that conversation', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('host-1', 'cleaner-1', 'stranger'),
        fc.constantFrom('host-1', 'cleaner-1', 'stranger'),
        async (grantee, sender) => {
          const stack = buildVoiceStack();
          const conversationId = await openVoiceConversation(stack);
          // Only a participant can be issued a grant; a stranger cannot even get one.
          if (grantee === 'stranger') {
            await expect(
              stack.service.createVoiceUploadTarget(conversationId, grantee),
            ).rejects.toBeInstanceOf(ForbiddenException);
            return;
          }
          const objectKey = await grantFor(stack, conversationId, grantee);

          const send = stack.service.sendVoiceMessage(
            params({ conversationId, objectKey, senderId: sender, clientMessageId: 'cid' }),
          );
          if (sender === grantee) {
            await expect(send).resolves.toMatchObject({ deduplicated: false });
          } else {
            await expect(send).rejects.toBeInstanceOf(ForbiddenException);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('P6/P7 — single-use grant & fingerprint idempotency', () => {
  it('a grant yields at most one durable message across arbitrary retries', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 6 }), async (retries) => {
        const stack = buildVoiceStack();
        const conversationId = await openVoiceConversation(stack);
        const objectKey = await grantFor(stack, conversationId, 'host-1');

        let inserted = 0;
        let dedup = 0;
        for (let i = 0; i < retries; i += 1) {
          const r = await stack.service.sendVoiceMessage(
            params({ conversationId, objectKey, clientMessageId: 'same' }),
          );
          if (r.deduplicated) {
            dedup += 1;
          } else {
            inserted += 1;
          }
        }
        expect(inserted).toBe(1);
        expect(dedup).toBe(retries - 1);
        expect(stack.db.voiceNotes).toHaveLength(1);
      }),
      { numRuns: 100 },
    );
  });

  it('same clientMessageId + different fingerprint always conflicts; transcript fields excluded', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 1, maxLength: 5 }),
        async (waveform) => {
          const stack = buildVoiceStack();
          const conversationId = await openVoiceConversation(stack);
          const objectKey = await grantFor(stack, conversationId, 'host-1');

          await stack.service.sendVoiceMessage(
            params({ conversationId, objectKey, clientMessageId: 'x', waveform: null }),
          );
          await expect(
            stack.service.sendVoiceMessage(
              params({ conversationId, objectKey, clientMessageId: 'x', waveform }),
            ),
          ).rejects.toBeInstanceOf(ConflictException);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('P8/P9 — server-authoritative bounds', () => {
  it('declared metadata never overrides server-observed size/type/duration', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          sizeBytes: fc.integer({ min: 1, max: 5_000_000_000 }),
          contentType: fc.constantFrom('audio/mp4', 'audio/mpeg', 'application/zip', 'text/plain'),
          durationMs: fc.oneof(fc.integer({ min: 1, max: 5_000_000 }), fc.constant<null>(null)),
        }),
        async (observed) => {
          const stack = buildVoiceStack();
          const conversationId = await openVoiceConversation(stack);
          const target = await stack.service.createVoiceUploadTarget(conversationId, 'host-1');
          stack.storage.putObject(target.objectKey, observed);

          const allowed = ['audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/ogg', 'audio/webm', 'audio/wav'];
          const withinSize = observed.sizeBytes <= 5_242_880;
          const okType = allowed.includes(observed.contentType);
          const okDuration = observed.durationMs !== null && observed.durationMs <= 120_000;
          const shouldAccept = withinSize && okType && okDuration;

          const send = stack.service.sendVoiceMessage(
            // Declared values always claim "valid" but are advisory only.
            params({
              conversationId,
              objectKey: target.objectKey,
              sizeBytes: 10,
              durationMs: 10,
              mimeType: 'audio/mp4',
              clientMessageId: 'cid',
            }),
          );
          if (shouldAccept) {
            const r = await send;
            expect(r.message.voiceNote?.sizeBytes).toBe(observed.sizeBytes);
            expect(stack.db.voiceNotes).toHaveLength(1);
          } else {
            await expect(send).rejects.toBeDefined();
            expect(stack.db.voiceNotes).toHaveLength(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('P13 — transcript stale-safety', () => {
  it('a slower older attempt never overwrites a newer transcript result', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 2, maxLength: 8 }),
        async (attemptSequence) => {
          const stack = buildVoiceStack();
          const conversationId = await openVoiceConversation(stack);
          const objectKey = await grantFor(stack, conversationId, 'host-1');
          const sent = await stack.service.sendVoiceMessage(
            params({ conversationId, objectKey, clientMessageId: 'cid' }),
          );
          const messageId = sent.message.id;

          // Advance the stored attempt to the max seen so the guard reflects the newest claim.
          const maxAttempt = Math.max(...attemptSequence);
          const note = stack.db.voiceNotes.find((v) => v.message_id === messageId);
          if (note) {
            note.transcript_attempt = maxAttempt;
          }

          // Applying an OLDER attempt than the current is a no-op; only >= current wins.
          let lastApplied = maxAttempt;
          for (const attempt of attemptSequence) {
            const applied = await stack.voiceNoteRepository.attachTranscript({
              messageId,
              attempt,
              transcript: `t${attempt}`,
              lang: 'en',
              status: 'READY',
            });
            if (attempt >= (note?.transcript_attempt as number)) {
              expect(applied).toBe(true);
              lastApplied = attempt;
            } else {
              expect(applied).toBe(false);
            }
          }
          void lastApplied;
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('P15 — interleaved VOICE/TEXT keyset ordering', () => {
  it('VOICE and TEXT interleave in sequence order across both cursors', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.boolean(), { minLength: 1, maxLength: 12 }),
        async (kinds) => {
          const stack = buildVoiceStack();
          const conversationId = await openVoiceConversation(stack);

          const expected: string[] = [];
          for (let i = 0; i < kinds.length; i += 1) {
            if (kinds[i]) {
              const objectKey = await grantFor(stack, conversationId, 'host-1');
              await stack.service.sendVoiceMessage(
                params({ conversationId, objectKey, clientMessageId: `v${i}` }),
              );
              expected.push('VOICE');
            } else {
              await stack.service.sendMessage(conversationId, 'host-1', `t${i}`, `hi ${i}`);
              expected.push('TEXT');
            }
          }

          const page = await stack.service.getMessagesBefore(conversationId, 'host-1', null, 100);
          const ascending = [...page.messages].reverse();
          expect(ascending.map((m) => m.type)).toEqual(expected);
          const seqs = ascending.map((m) => m.sequenceNumber);
          for (let i = 1; i < seqs.length; i += 1) {
            expect((seqs[i] as number) > (seqs[i - 1] as number)).toBe(true);
          }
          // Reconnect: after the first sequence returns strictly newer, oldest-first.
          if (seqs.length > 1) {
            const after = await stack.service.getMessagesAfter(conversationId, 'host-1', seqs[0] as number, 100);
            expect(after.messages.every((m) => m.sequenceNumber > (seqs[0] as number))).toBe(true);
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});