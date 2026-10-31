import { VoipSweepProcessor } from '../voip-sweep.processor';
import { VoipRepository, VoipCallRow } from '../voip.repository';
import { CallStatus, EndReason, MediaKind } from '../voip.constants';

/**
 * Unit tests for VoipSweepProcessor (Task 8.2).
 *
 * Validates: Requirements 4.1, 4.2 · P10, P11, P12.
 * - the ring sweep transitions only aged RINGING → MISSED/TIMEOUT_NO_ANSWER (single-winner);
 * - the stale sweep transitions only aged/over-max ONGOING → ENDED/TIMEOUT (single-winner);
 * - both are idempotent (a lost race sets nothing, publishes nothing) and a publish failure never
 *   stalls the batch.
 */

function endedRow(overrides: Partial<VoipCallRow> = {}): VoipCallRow {
  return {
    id: 'call-1',
    conversation_id: 'conv-1',
    offer_id: 'offer-1',
    initiator_id: 'user-a',
    callee_id: 'user-b',
    media_kind: MediaKind.AUDIO,
    room_name: 'call-room-1',
    status: CallStatus.MISSED,
    end_reason: EndReason.TIMEOUT_NO_ANSWER,
    client_call_id: 'ccid-1',
    initiated_at: new Date(),
    answered_at: null,
    ended_at: new Date(),
    last_media_activity_at: null,
    duration_seconds: 0,
    ...overrides,
  };
}

function build(): {
  processor: VoipSweepProcessor;
  repo: jest.Mocked<Partial<VoipRepository>>;
  publisher: { publish: jest.Mock };
} {
  const repo: jest.Mocked<Partial<VoipRepository>> = {
    findRingingOlderThan: jest.fn(async () => []),
    findStaleOngoing: jest.fn(async () => []),
    transitionTerminal: jest.fn(async () => null),
  };
  const publisher = { publish: jest.fn(async () => true) };
  const queue = { add: jest.fn(async () => undefined) };
  const processor = new VoipSweepProcessor(
    queue as never,
    repo as VoipRepository,
    publisher as never,
  );
  return { processor, repo, publisher };
}

describe('VoipSweepProcessor — ring-timeout sweep', () => {
  it('transitions aged RINGING calls to MISSED/TIMEOUT_NO_ANSWER (single-winner)', async () => {
    const { processor, repo, publisher } = build();
    (repo.findRingingOlderThan as jest.Mock).mockResolvedValueOnce([
      { id: 'call-1', conversationId: 'conv-1' },
    ]);
    (repo.transitionTerminal as jest.Mock).mockResolvedValueOnce(endedRow());

    await processor.sweepRingTimeouts();

    expect(repo.transitionTerminal).toHaveBeenCalledWith(
      'call-1',
      CallStatus.RINGING,
      CallStatus.MISSED,
      EndReason.TIMEOUT_NO_ANSWER,
    );
    expect(publisher.publish).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ type: 'call_end', endReason: EndReason.TIMEOUT_NO_ANSWER }),
    );
  });

  it('a lost race (rows=0) publishes nothing (idempotent)', async () => {
    const { processor, repo, publisher } = build();
    (repo.findRingingOlderThan as jest.Mock).mockResolvedValueOnce([
      { id: 'call-1', conversationId: 'conv-1' },
    ]);
    (repo.transitionTerminal as jest.Mock).mockResolvedValueOnce(null);
    await processor.sweepRingTimeouts();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('does nothing when no RINGING calls are aged', async () => {
    const { processor, repo } = build();
    await processor.sweepRingTimeouts();
    expect(repo.transitionTerminal).not.toHaveBeenCalled();
  });
});

describe('VoipSweepProcessor — stale-call sweep', () => {
  it('transitions aged/over-max ONGOING calls to ENDED/TIMEOUT (single-winner)', async () => {
    const { processor, repo, publisher } = build();
    (repo.findStaleOngoing as jest.Mock).mockResolvedValueOnce([
      { id: 'call-2', conversationId: 'conv-2' },
    ]);
    (repo.transitionTerminal as jest.Mock).mockResolvedValueOnce(
      endedRow({ id: 'call-2', status: CallStatus.ENDED, end_reason: EndReason.TIMEOUT, duration_seconds: 120 }),
    );

    await processor.sweepStaleCalls();

    expect(repo.transitionTerminal).toHaveBeenCalledWith(
      'call-2',
      CallStatus.ONGOING,
      CallStatus.ENDED,
      EndReason.TIMEOUT,
    );
    expect(publisher.publish).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ type: 'call_end', endReason: EndReason.TIMEOUT, durationSeconds: 120 }),
    );
  });

  it('a publish failure never stalls the batch', async () => {
    const { processor, repo, publisher } = build();
    (repo.findStaleOngoing as jest.Mock).mockResolvedValueOnce([
      { id: 'call-2', conversationId: 'conv-2' },
      { id: 'call-3', conversationId: 'conv-3' },
    ]);
    (repo.transitionTerminal as jest.Mock).mockResolvedValue(endedRow({ status: CallStatus.ENDED }));
    publisher.publish.mockRejectedValue(new Error('centrifugo down'));
    await expect(processor.sweepStaleCalls()).resolves.toBeUndefined();
    expect(repo.transitionTerminal).toHaveBeenCalledTimes(2);
  });
});

describe('VoipSweepProcessor — full pass', () => {
  it('sweep() runs both ring and stale sweeps and never throws', async () => {
    const { processor, repo } = build();
    (repo.findRingingOlderThan as jest.Mock).mockRejectedValueOnce(new Error('db blip'));
    await expect(processor.sweep()).resolves.toBeUndefined();
    // Even though the ring sweep threw internally (guarded), the stale sweep still ran.
    expect(repo.findStaleOngoing).toHaveBeenCalled();
  });
});
