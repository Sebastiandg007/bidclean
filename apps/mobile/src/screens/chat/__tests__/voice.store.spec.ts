/**
 * Unit + property-based tests for the voice-note store actions (task 12.4 · P14).
 *
 * Covers: optimistic VOICE send (sending placeholder keyed by clientMessageId, own local audio uri)
 * reconciled on success and flipped to failed on timeout; applyTranscriptUpdate upsert by
 * message.id ignoring an older transcriptAttempt (P14). `voice.api` + `expo-crypto` are mocked.
 */

import * as fc from 'fast-check';

import { useChatStore } from '../chat.store';
import { CHAT_SEND_TIMEOUT_MS } from '../chat.constants';
import type { ChatMessage, ChatSendResult, RecordedClip } from '../chat.types';

jest.mock('../voice.api', () => ({
  uploadAndSendVoiceNote: jest.fn(),
  requestUploadUrl: jest.fn(),
  uploadAudioToStorage: jest.fn(),
  sendVoiceMessageRequest: jest.fn(),
  requestPlaybackUrl: jest.fn(),
}));

let mockCryptoCounter = 0;
jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn(async () => {
    mockCryptoCounter += 1;
    const bytes = new Uint8Array(16);
    bytes[0] = mockCryptoCounter & 0xff;
    bytes[1] = (mockCryptoCounter >> 8) & 0xff;
    return bytes;
  }),
}));

import { uploadAndSendVoiceNote } from '../voice.api';

const mockedSend = uploadAndSendVoiceNote as jest.MockedFunction<typeof uploadAndSendVoiceNote>;

const CONVERSATION_ID = 'conv-1';

function clip(): RecordedClip {
  return { uri: 'file:///tmp/a.m4a', durationMs: 4000, sizeBytes: 2048, mimeType: 'audio/mp4' };
}

function serverVoiceMessage(clientMessageId: string, seq = 1): ChatMessage {
  return {
    id: `srv-${seq}`,
    conversationId: CONVERSATION_ID,
    senderId: 'host-1',
    type: 'VOICE',
    body: null,
    sequenceNumber: seq,
    clientMessageId,
    createdAt: new Date().toISOString(),
    voiceNote: {
      durationMs: 4000,
      sizeBytes: 2048,
      mimeType: 'audio/mp4',
      waveform: null,
      transcript: null,
      transcriptStatus: 'PENDING',
      transcriptLang: null,
      transcriptAttempt: 0,
    },
  };
}

describe('chat store — voice send (12.4)', () => {
  beforeEach(() => {
    useChatStore.getState().reset();
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('shows an optimistic VOICE placeholder then reconciles to the server message', async () => {
    let resolveSend: (r: ChatSendResult) => void = () => undefined;
    mockedSend.mockReturnValue(
      new Promise<ChatSendResult>((resolve) => {
        resolveSend = resolve;
      }),
    );

    const sendPromise = useChatStore.getState().sendVoiceNote(CONVERSATION_ID, clip(), null);
    // The optimistic insert happens after awaiting the async client-message-id generation.
    await Promise.resolve();
    await Promise.resolve();

    // Optimistic placeholder is present: VOICE, sending, local audio uri.
    const optimistic = useChatStore.getState().getMessages(CONVERSATION_ID);
    expect(optimistic).toHaveLength(1);
    expect(optimistic[0]?.type).toBe('VOICE');
    expect(optimistic[0]?.sendState).toBe('sending');
    expect(optimistic[0]?.localAudioUri).toBe('file:///tmp/a.m4a');

    const cmid = optimistic[0]?.clientMessageId as string;
    resolveSend({ message: serverVoiceMessage(cmid), deduplicated: false });
    await sendPromise;

    const reconciled = useChatStore.getState().getMessages(CONVERSATION_ID);
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]?.id).toBe('srv-1');
    expect(reconciled[0]?.sendState).toBeUndefined();
  });

  it('flips the optimistic VOICE placeholder to failed on timeout', async () => {
    // A send that never resolves; the bounded timeout should flip the placeholder to failed.
    mockedSend.mockReturnValue(new Promise<ChatSendResult>(() => undefined));
    jest.useFakeTimers();

    const sendPromise = useChatStore.getState().sendVoiceNote(CONVERSATION_ID, clip(), null);
    // Flush the async client-message-id + optimistic insert + setTimeout scheduling.
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(CHAT_SEND_TIMEOUT_MS + 1);

    const list = useChatStore.getState().getMessages(CONVERSATION_ID);
    expect(list[0]?.sendState).toBe('failed');
    jest.useRealTimers();
    void sendPromise;
  });
});

describe('chat store — applyTranscriptUpdate (P14)', () => {
  beforeEach(() => {
    useChatStore.getState().reset();
  });

  function seedVoiceMessage(attempt: number): void {
    const message = serverVoiceMessage('cmid', 1);
    const withAttempt: ChatMessage = {
      ...message,
      voiceNote: { ...message.voiceNote!, transcriptAttempt: attempt },
    };
    useChatStore.getState().onIncomingMessage(withAttempt);
  }

  it('applies a READY update and ignores a later stale (older-attempt) update', () => {
    seedVoiceMessage(0);
    useChatStore.getState().applyTranscriptUpdate({
      type: 'voice_transcript_updated',
      messageId: 'srv-1',
      transcriptAttempt: 2,
      transcriptStatus: 'READY',
      transcript: 'hello there',
      transcriptLang: 'en',
    });
    let note = useChatStore.getState().getMessages(CONVERSATION_ID)[0]?.voiceNote;
    expect(note?.transcriptStatus).toBe('READY');
    expect(note?.transcript).toBe('hello there');
    expect(note?.transcriptAttempt).toBe(2);

    // A stale update (attempt 1 < applied 2) must be ignored.
    useChatStore.getState().applyTranscriptUpdate({
      type: 'voice_transcript_updated',
      messageId: 'srv-1',
      transcriptAttempt: 1,
      transcriptStatus: 'FAILED',
      transcript: null,
    });
    note = useChatStore.getState().getMessages(CONVERSATION_ID)[0]?.voiceNote;
    expect(note?.transcriptStatus).toBe('READY');
    expect(note?.transcript).toBe('hello there');
    expect(note?.transcriptAttempt).toBe(2);
  });

  it('property: applying updates in any order converges to the highest attempt (P14)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 20 }), { minLength: 1, maxLength: 10 }),
        (attempts) => {
          useChatStore.getState().reset();
          seedVoiceMessage(0);
          for (const attempt of attempts) {
            useChatStore.getState().applyTranscriptUpdate({
              type: 'voice_transcript_updated',
              messageId: 'srv-1',
              transcriptAttempt: attempt,
              transcriptStatus: 'READY',
              transcript: `t${attempt}`,
            });
          }
          const note = useChatStore.getState().getMessages(CONVERSATION_ID)[0]?.voiceNote;
          const maxAttempt = Math.max(0, ...attempts);
          // Never regresses below the highest attempt seen.
          expect(note?.transcriptAttempt).toBe(maxAttempt);
          // Exactly one message (no duplication).
          expect(useChatStore.getState().getMessages(CONVERSATION_ID)).toHaveLength(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});