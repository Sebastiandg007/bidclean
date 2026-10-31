/**
 * Unit tests for parseCallSignal (the pure parser behind useCallSignaling).
 *
 * Validates that only well-formed `call_*` frames on the shared chat channel are accepted (and
 * fully narrowed), and that non-call / malformed frames are ignored — so a chat message never
 * misroutes into the call store and vice-versa.
 *
 * @requirements 5.2, 5.5 · P15
 */

import { parseCallSignal } from '../useCallSignaling';

describe('parseCallSignal', () => {
  it('parses a call_invite with all required fields', () => {
    const signal = parseCallSignal({
      type: 'call_invite',
      callId: 'c1',
      conversationId: 'conv-1',
      initiatorId: 'host-1',
      mediaKind: 'VIDEO',
    });
    expect(signal).toEqual({
      type: 'call_invite',
      callId: 'c1',
      conversationId: 'conv-1',
      initiatorId: 'host-1',
      mediaKind: 'VIDEO',
    });
  });

  it('parses a call_end with reason + duration', () => {
    const signal = parseCallSignal({
      type: 'call_end',
      callId: 'c1',
      endReason: 'HANGUP',
      durationSeconds: 42,
    });
    expect(signal).toEqual({
      type: 'call_end',
      callId: 'c1',
      endReason: 'HANGUP',
      durationSeconds: 42,
    });
  });

  it('parses minimal accept/decline/cancel/ringing/busy frames', () => {
    for (const type of ['call_ringing', 'call_accept', 'call_decline', 'call_cancel', 'call_busy']) {
      expect(parseCallSignal({ type, callId: 'c1' })).toEqual({ type, callId: 'c1' });
    }
  });

  it('rejects a chat message frame (not a call signal)', () => {
    expect(parseCallSignal({ type: 'chat_message', message: { id: 'm1' } })).toBeNull();
  });

  it('rejects malformed frames (missing callId, bad mediaKind, non-object)', () => {
    expect(parseCallSignal({ type: 'call_invite', conversationId: 'conv-1', mediaKind: 'AUDIO' })).toBeNull();
    expect(
      parseCallSignal({ type: 'call_invite', callId: 'c1', conversationId: 'conv-1', mediaKind: 'X' }),
    ).toBeNull();
    expect(parseCallSignal({ type: 'call_end', callId: 'c1' })).toBeNull();
    expect(parseCallSignal(null)).toBeNull();
    expect(parseCallSignal('nope')).toBeNull();
  });

  it('defaults call_end durationSeconds to null when absent', () => {
    const signal = parseCallSignal({ type: 'call_end', callId: 'c1', endReason: 'TIMEOUT' });
    expect(signal).toEqual({ type: 'call_end', callId: 'c1', endReason: 'TIMEOUT', durationSeconds: null });
  });
});
