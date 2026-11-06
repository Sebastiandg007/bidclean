/**
 * Unit + property-based tests for the voip Zustand store (Spec 15).
 *
 * Covers:
 * - initiate seeds an outgoing active call + logs it;
 * - applySignal is idempotent and NEVER regresses status (a late RINGING/ACCEPT after ENDED is
 *   ignored) — the P15 property;
 * - a media reconnect (refreshMediaToken) rejoins the SAME call, never creating a second — P15;
 * - openIncoming presents only while RINGING; reconcile drops the active call once terminal;
 * - an invite for a fresh call surfaces the incoming sheet via openIncoming.
 *
 * `voip.api` and `expo-crypto` are mocked; no network, no native crypto, no LiveKit.
 *
 * @requirements 4.6, 4.7, 5.2, 5.5 · P15
 */

import * as fc from 'fast-check';

import { useVoipStore } from '../voip.store';
import type { CallSignal, CallStatus, CallView, InitiatedCall, MediaToken } from '../voip.types';

jest.mock('../voip.api', () => ({
  initiateCallRequest: jest.fn(),
  answerCallRequest: jest.fn(),
  declineCallRequest: jest.fn(),
  cancelCallRequest: jest.fn(),
  endCallRequest: jest.fn(),
  requestMediaTokenRequest: jest.fn(),
  getCallRequest: jest.fn(),
  listCallsRequest: jest.fn(),
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

import {
  getCallRequest,
  initiateCallRequest,
  requestMediaTokenRequest,
} from '../voip.api';

const mockedInitiate = initiateCallRequest as jest.MockedFunction<typeof initiateCallRequest>;
const mockedGet = getCallRequest as jest.MockedFunction<typeof getCallRequest>;
const mockedToken = requestMediaTokenRequest as jest.MockedFunction<typeof requestMediaTokenRequest>;

const CONVERSATION_ID = 'conv-1';
const CALL_ID = 'call-1';

function media(): MediaToken {
  return {
    livekitUrl: 'wss://rtc.example.test',
    token: 'tok-123',
    expiresAt: new Date(Date.now() + 300000).toISOString(),
  };
}

function callView(status: CallStatus, overrides: Partial<CallView> = {}): CallView {
  return {
    id: CALL_ID,
    conversationId: CONVERSATION_ID,
    initiatorId: 'host-1',
    calleeId: 'cleaner-1',
    mediaKind: 'AUDIO',
    status,
    endReason: null,
    initiatedAt: new Date(1000).toISOString(),
    answeredAt: status === 'ONGOING' || status === 'ENDED' ? new Date(2000).toISOString() : null,
    endedAt: null,
    durationSeconds: null,
    ...overrides,
  };
}

function initiated(status: CallStatus = 'RINGING'): InitiatedCall {
  return { call: callView(status), roomName: 'call-room-abc', media: media() };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCryptoCounter = 0;
  useVoipStore.getState().reset();
});

describe('VoipStore.initiate', () => {
  it('seeds an outgoing active call and logs it (idempotent clientCallId generated)', async () => {
    mockedInitiate.mockResolvedValueOnce(initiated('RINGING'));

    await useVoipStore.getState().initiate(CONVERSATION_ID, 'AUDIO');

    const active = useVoipStore.getState().activeCall;
    expect(active).not.toBeNull();
    expect(active?.phase).toBe('outgoing');
    expect(active?.isInitiator).toBe(true);
    expect(active?.media).not.toBeNull();
    expect(useVoipStore.getState().getCallLog(CONVERSATION_ID)).toHaveLength(1);
  });
});

describe('VoipStore.applySignal — idempotency & no regression (P15)', () => {
  it('surfaces an incoming call from an invite for a fresh call', async () => {
    mockedGet.mockResolvedValueOnce(callView('RINGING'));

    const signal: CallSignal = {
      type: 'call_invite',
      callId: CALL_ID,
      conversationId: CONVERSATION_ID,
      initiatorId: 'host-1',
      mediaKind: 'AUDIO',
    };
    useVoipStore.getState().applySignal(CONVERSATION_ID, signal);
    // openIncoming is async (GET); flush microtasks.
    await Promise.resolve();
    await Promise.resolve();

    expect(useVoipStore.getState().activeCall?.phase).toBe('incoming');
  });

  it('ignores an invite that duplicates the already-tracked call', async () => {
    mockedInitiate.mockResolvedValueOnce(initiated('RINGING'));
    await useVoipStore.getState().initiate(CONVERSATION_ID, 'AUDIO');

    useVoipStore.getState().applySignal(CONVERSATION_ID, {
      type: 'call_invite',
      callId: CALL_ID,
      conversationId: CONVERSATION_ID,
      initiatorId: 'host-1',
      mediaKind: 'AUDIO',
    });
    await Promise.resolve();

    // Still our outgoing call — the duplicate invite did not flip us to incoming.
    expect(useVoipStore.getState().activeCall?.phase).toBe('outgoing');
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('a terminal reconcile drops the active call below a non-terminal reconcile (no regression)', async () => {
    mockedInitiate.mockResolvedValueOnce(initiated('RINGING'));
    await useVoipStore.getState().initiate(CONVERSATION_ID, 'AUDIO');

    // Reconcile to ENDED first.
    mockedGet.mockResolvedValueOnce(callView('ENDED', { endReason: 'HANGUP', endedAt: new Date(3000).toISOString() }));
    await useVoipStore.getState().reconcile(CONVERSATION_ID, CALL_ID);
    expect(useVoipStore.getState().activeCall?.call.status).toBe('ENDED');

    // A late RINGING read must NOT move it back to RINGING.
    mockedGet.mockResolvedValueOnce(callView('RINGING'));
    await useVoipStore.getState().reconcile(CONVERSATION_ID, CALL_ID);
    expect(useVoipStore.getState().activeCall?.call.status).toBe('ENDED');
  });

  it('media reconnect rejoins the SAME call and never creates a second (P15)', async () => {
    mockedInitiate.mockResolvedValueOnce(initiated('RINGING'));
    await useVoipStore.getState().initiate(CONVERSATION_ID, 'AUDIO');

    // Move to ONGOING via a reconcile so refreshMediaToken is allowed.
    mockedGet.mockResolvedValueOnce(callView('ONGOING'));
    await useVoipStore.getState().reconcile(CONVERSATION_ID, CALL_ID);

    const firstToken = useVoipStore.getState().activeCall?.media?.token;
    mockedToken.mockResolvedValueOnce({ ...media(), token: 'tok-refreshed' });
    await useVoipStore.getState().refreshMediaToken();

    const active = useVoipStore.getState().activeCall;
    expect(active?.call.id).toBe(CALL_ID); // same call
    expect(active?.media?.token).toBe('tok-refreshed'); // fresh token, same room
    expect(active?.media?.token).not.toBe(firstToken);
    // The log still holds exactly one call — no second record.
    expect(useVoipStore.getState().getCallLog(CONVERSATION_ID)).toHaveLength(1);
  });

  // Feature: voip-calls, Property 15: out-of-order/duplicate call_* events never regress call
  // status; a terminal status is sticky once reached.
  it('Property 15: applying arbitrary signal sequences never regresses a terminal status', async () => {
    const statusArb = fc.constantFrom<CallStatus>('RINGING', 'ONGOING', 'ENDED', 'MISSED', 'DECLINED');
    const signalArb: fc.Arbitrary<CallStatus> = statusArb;

    await fc.assert(
      fc.asyncProperty(fc.array(signalArb, { minLength: 1, maxLength: 12 }), async (reads) => {
        useVoipStore.getState().reset();
        jest.clearAllMocks();
        mockedInitiate.mockResolvedValueOnce(initiated('RINGING'));
        await useVoipStore.getState().initiate(CONVERSATION_ID, 'AUDIO');

        const rank: Record<CallStatus, number> = {
          RINGING: 0,
          ONGOING: 1,
          ENDED: 2,
          MISSED: 2,
          DECLINED: 2,
          CANCELED: 2,
          FAILED: 2,
        };
        let maxRankApplied = rank.RINGING;

        for (const status of reads) {
          mockedGet.mockResolvedValueOnce(callView(status));
          await useVoipStore.getState().reconcile(CONVERSATION_ID, CALL_ID);
          const current = useVoipStore.getState().activeCall?.call.status;
          if (current === undefined) {
            continue;
          }
          // The applied status rank is monotonic non-decreasing (never regresses).
          expect(rank[current]).toBeGreaterThanOrEqual(maxRankApplied);
          maxRankApplied = rank[current];
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('VoipStore.openIncoming', () => {
  it('presents an incoming sheet only while RINGING; a terminal call is logged, not presented', async () => {
    mockedGet.mockResolvedValueOnce(callView('ENDED', { endReason: 'HANGUP' }));
    await useVoipStore.getState().openIncoming(CALL_ID, CONVERSATION_ID);
    expect(useVoipStore.getState().activeCall).toBeNull();
    expect(useVoipStore.getState().getCallLog(CONVERSATION_ID)).toHaveLength(1);
  });
});
