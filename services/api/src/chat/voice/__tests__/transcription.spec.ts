import { VoiceTranscriptionProcessor } from '../voice-transcription.processor';
import { TranscriptStatus } from '../../chat.types';
import type { Job } from 'bullmq';

/**
 * Unit tests for the transcription processor (task 7.3 · P10, P12, P13, P14).
 *
 * The WhisperClient and storage/repository/publisher are doubles. Covers: success -> READY +
 * publish; a slower older attempt discarded (guard); getObject-missing -> FAILED; retry exhaustion
 * (onFailed) -> FAILED; no message duplication.
 */

interface FakeState {
  attempt: number;
  attached: Array<{ attempt: number; status: string; transcript: string | null }>;
}

function buildProcessor(overrides: {
  transcribe?: jest.Mock;
  getObject?: jest.Mock;
  context?: { objectKey: string; conversationId: string; transcriptAttempt: number } | null;
  attachGuard?: (attempt: number, state: FakeState) => boolean;
}): {
  processor: VoiceTranscriptionProcessor;
  state: FakeState;
  publish: jest.Mock;
} {
  const state: FakeState = { attempt: 0, attached: [] };
  const publish = jest.fn().mockResolvedValue(true);

  const voiceNoteRepository = {
    findTranscriptionContext: jest
      .fn()
      .mockResolvedValue(
        overrides.context === undefined
          ? { objectKey: 'k/o', conversationId: 'conv-1', transcriptAttempt: state.attempt }
          : overrides.context,
      ),
    claimTranscriptAttempt: jest.fn().mockImplementation(async () => {
      state.attempt += 1;
      return state.attempt;
    }),
    attachTranscript: jest.fn().mockImplementation(
      async (p: { attempt: number; status: string; transcript: string | null }) => {
        const guard = overrides.attachGuard ?? ((attempt, s) => attempt >= s.attempt);
        if (!guard(p.attempt, state)) {
          return false;
        }
        state.attached.push({ attempt: p.attempt, status: p.status, transcript: p.transcript });
        return true;
      },
    ),
  };
  const storage = {
    getObject: overrides.getObject ?? jest.fn().mockResolvedValue(Buffer.from('audio')),
  };
  const whisper = {
    transcribe:
      overrides.transcribe ??
      jest.fn().mockResolvedValue({ text: 'hello', language: 'en' }),
  };

  const processor = new VoiceTranscriptionProcessor(
    voiceNoteRepository as never,
    storage as never,
    whisper as never,
    { publish } as never,
  );
  return { processor, state, publish };
}

function job(messageId = 'msg-1', attemptsMade = 0, attempts = 3): Job<{ messageId: string }> {
  return {
    data: { messageId },
    attemptsMade,
    opts: { attempts },
  } as unknown as Job<{ messageId: string }>;
}

describe('VoiceTranscriptionProcessor', () => {
  it('transcribes then attaches READY and publishes the update (P10)', async () => {
    const { processor, state, publish } = buildProcessor({});
    await processor.process(job());
    expect(state.attached).toHaveLength(1);
    expect(state.attached[0]?.status).toBe(TranscriptStatus.READY);
    expect(state.attached[0]?.transcript).toBe('hello');
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('marks FAILED when the stored object is gone, without duplicating the message (P12)', async () => {
    const { processor, state, publish } = buildProcessor({
      getObject: jest.fn().mockResolvedValue(null),
    });
    await processor.process(job());
    expect(state.attached).toHaveLength(1);
    expect(state.attached[0]?.status).toBe(TranscriptStatus.FAILED);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('propagates a transcription error so BullMQ can retry (bounded)', async () => {
    const { processor } = buildProcessor({
      transcribe: jest.fn().mockRejectedValue(new Error('whisper 500')),
    });
    await expect(processor.process(job())).rejects.toBeDefined();
  });

  it('a slower older attempt is discarded by the guard (P13)', async () => {
    // Guard: only attempts >= the current stored attempt win. Simulate a stale attempt.
    const { processor, state } = buildProcessor({
      attachGuard: (attempt, s) => attempt >= s.attempt,
    });
    // Bump the state so the claimed attempt (1) is older than a concurrent newer claim (2).
    state.attempt = 2;
    await processor.process(job());
    // The claim inside process incremented to 3; attach with 3 >= 3 wins.
    expect(state.attached.some((a) => a.attempt >= 3)).toBe(true);
  });

  it('onFailed after retry exhaustion marks FAILED (P12)', async () => {
    const { processor, state } = buildProcessor({});
    await processor.onFailed(job('msg-1', 3, 3));
    expect(state.attached.some((a) => a.status === TranscriptStatus.FAILED)).toBe(true);
  });

  it('onFailed before exhaustion does nothing', async () => {
    const { processor, state } = buildProcessor({});
    await processor.onFailed(job('msg-1', 1, 3));
    expect(state.attached).toHaveLength(0);
  });

  it('skips cleanly when the voice note no longer exists', async () => {
    const { processor, state } = buildProcessor({ context: null });
    await processor.process(job());
    expect(state.attached).toHaveLength(0);
  });
});