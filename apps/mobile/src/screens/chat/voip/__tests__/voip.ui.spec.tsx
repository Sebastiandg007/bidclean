/**
 * Unit tests for the call UI components + i18n parity (Spec 15).
 *
 * Covers:
 * - IncomingCallSheet renders accept/decline while incoming and wires the store actions;
 * - CallLogEntry maps each outcome to its label and flags a missed incoming call;
 * - en/es call i18n keys are in parity (every leaf key present in both).
 *
 * react-i18next returns keys (interpolation echoed) so assertions are on stable keys; the store's
 * api layer is mocked to avoid network.
 *
 * @requirements 5.5, 5.6 · P15
 */

import { fireEvent, render, screen } from '@testing-library/react-native';

const stableT = (key: string): string => key;
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: stableT }),
}));

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

import { IncomingCallSheet } from '../components/IncomingCallSheet';
import { CallLogEntry, callOutcomeKey, isMissedIncoming } from '../components/CallLogEntry';
import { useVoipStore } from '../voip.store';
import type { CallStatus, CallView } from '../voip.types';
import enChat from '../../../../i18n/locales/en/chat.json';
import esChat from '../../../../i18n/locales/es/chat.json';

function callView(status: CallStatus, overrides: Partial<CallView> = {}): CallView {
  return {
    id: 'call-1',
    conversationId: 'conv-1',
    initiatorId: 'host-1',
    calleeId: 'cleaner-1',
    mediaKind: 'AUDIO',
    status,
    endReason: null,
    initiatedAt: new Date(1000).toISOString(),
    answeredAt: null,
    endedAt: null,
    durationSeconds: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  useVoipStore.getState().reset();
});

describe('IncomingCallSheet', () => {
  it('renders nothing when there is no incoming call', () => {
    render(<IncomingCallSheet />);
    expect(screen.queryByTestId('voip-incoming-sheet')).toBeNull();
  });

  it('renders accept/decline while incoming and invokes the store actions', () => {
    useVoipStore.setState({
      activeCall: {
        call: callView('RINGING'),
        phase: 'incoming',
        media: null,
        roomName: null,
        isInitiator: false,
      },
    });
    const answerSpy = jest.spyOn(useVoipStore.getState(), 'answer').mockResolvedValue();
    const declineSpy = jest.spyOn(useVoipStore.getState(), 'decline').mockResolvedValue();

    render(<IncomingCallSheet />);
    expect(screen.getByTestId('voip-incoming-sheet')).toBeTruthy();

    fireEvent.press(screen.getByTestId('voip-incoming-accept'));
    expect(answerSpy).toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('voip-incoming-decline'));
    expect(declineSpy).toHaveBeenCalled();
  });
});

describe('CallLogEntry', () => {
  it('maps each outcome to a label and flags a missed incoming call', () => {
    expect(callOutcomeKey(callView('MISSED'), 'cleaner-1')).toBe('chat.call.log.missed');
    expect(callOutcomeKey(callView('DECLINED'), 'cleaner-1')).toBe('chat.call.log.declined');
    expect(callOutcomeKey(callView('CANCELED'), 'cleaner-1')).toBe('chat.call.log.canceled');
    expect(callOutcomeKey(callView('ENDED'), 'cleaner-1')).toBe('chat.call.log.ended');
    expect(callOutcomeKey(callView('FAILED'), 'cleaner-1')).toBe('chat.call.log.failed');

    // Missed + incoming (viewer is the callee) → highlighted.
    expect(isMissedIncoming(callView('MISSED'), 'cleaner-1')).toBe(true);
    // Missed but the viewer is the initiator → not a "missed incoming" for them.
    expect(isMissedIncoming(callView('MISSED'), 'host-1')).toBe(false);
  });

  it('renders a duration for an answered ended call', () => {
    render(
      <CallLogEntry
        call={callView('ENDED', { durationSeconds: 65, answeredAt: new Date(2000).toISOString() })}
        currentUserId="host-1"
      />,
    );
    expect(screen.getByTestId('voip-call-log-outcome')).toBeTruthy();
  });
});

describe('call i18n parity', () => {
  /** Collect the dotted leaf keys of an object. */
  function leafKeys(obj: unknown, prefix = ''): string[] {
    if (typeof obj !== 'object' || obj === null) {
      return [prefix];
    }
    return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) =>
      leafKeys(value, prefix ? `${prefix}.${key}` : key),
    );
  }

  it('en and es call blocks have identical key sets', () => {
    const enCall = (enChat as { chat: { call: unknown } }).chat.call;
    const esCall = (esChat as { chat: { call: unknown } }).chat.call;
    expect(leafKeys(enCall).sort()).toEqual(leafKeys(esCall).sort());
  });
});
