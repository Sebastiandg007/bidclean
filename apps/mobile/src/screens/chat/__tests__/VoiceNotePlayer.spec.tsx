/**
 * Unit tests for VoiceNotePlayer (task 13.3 · P16).
 *
 * Covers: renders each transcript state without blocking playback (READY shows text, PENDING shows
 * a hint, FAILED/DISABLED show a fallback); a fresh playback URL is fetched on demand when playing
 * a server message; own vs counterparty styling both render a play control. i18n returns keys.
 */

import { act, fireEvent, render, screen } from '@testing-library/react-native';

const stableT = (key: string): string => key;
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: stableT }),
}));

const mockRequestPlaybackUrl = jest.fn();
jest.mock('../voice.api', () => ({
  requestPlaybackUrl: (...args: unknown[]) => mockRequestPlaybackUrl(...args),
}));

import { VoiceNotePlayer } from '../components/VoiceNotePlayer';
import type { ChatMessage, TranscriptStatus } from '../chat.types';

function voiceMessage(
  status: TranscriptStatus,
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id: 'srv-1',
    conversationId: 'conv-1',
    senderId: 'user-other',
    type: 'VOICE',
    body: null,
    sequenceNumber: 1,
    clientMessageId: 'cmid-1',
    createdAt: new Date(1000).toISOString(),
    voiceNote: {
      durationMs: 5000,
      sizeBytes: 2048,
      mimeType: 'audio/mp4',
      waveform: null,
      transcript: status === 'READY' ? 'hello there' : null,
      transcriptStatus: status,
      transcriptLang: status === 'READY' ? 'en' : null,
      transcriptAttempt: status === 'READY' ? 1 : 0,
    },
    ...overrides,
  };
}

describe('VoiceNotePlayer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequestPlaybackUrl.mockResolvedValue({ playbackUrl: 'https://minio.test/get', expiresAt: 's' });
  });

  it('renders the transcript when READY', () => {
    render(<VoiceNotePlayer message={voiceMessage('READY')} isOwn={false} />);
    expect(screen.getByTestId('voice-note-transcript')).toBeTruthy();
    expect(screen.getByText('hello there')).toBeTruthy();
  });

  it('renders a subtle hint when PENDING (playback not blocked)', () => {
    render(<VoiceNotePlayer message={voiceMessage('PENDING')} isOwn={false} />);
    expect(screen.getByTestId('voice-note-transcript-pending')).toBeTruthy();
    expect(screen.getByTestId('voice-note-play-srv-1')).toBeTruthy();
  });

  it('renders an unobtrusive fallback when FAILED and when DISABLED', () => {
    const failed = render(<VoiceNotePlayer message={voiceMessage('FAILED')} isOwn={false} />);
    expect(failed.getByTestId('voice-note-transcript-fallback')).toBeTruthy();
    failed.unmount();
    render(<VoiceNotePlayer message={voiceMessage('DISABLED')} isOwn={false} />);
    expect(screen.getByTestId('voice-note-transcript-fallback')).toBeTruthy();
  });

  it('fetches a fresh playback URL on demand for a server message', async () => {
    render(<VoiceNotePlayer message={voiceMessage('READY')} isOwn={false} />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('voice-note-play-srv-1'));
      await Promise.resolve();
    });
    expect(mockRequestPlaybackUrl).toHaveBeenCalledWith('conv-1', 'srv-1');
  });

  it('uses the local audio uri (no playback fetch) for an own optimistic send', async () => {
    const own = voiceMessage('PENDING', {
      id: 'local:cmid-1',
      senderId: null,
      sendState: 'sending',
      localAudioUri: 'file:///tmp/a.m4a',
    });
    render(<VoiceNotePlayer message={own} isOwn />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('voice-note-play-local:cmid-1'));
      await Promise.resolve();
    });
    expect(mockRequestPlaybackUrl).not.toHaveBeenCalled();
  });

  it('renders the duration and a waveform for both own and counterparty', () => {
    const { rerender } = render(<VoiceNotePlayer message={voiceMessage('READY')} isOwn={false} />);
    expect(screen.getByTestId('voice-note-duration-srv-1')).toBeTruthy();
    expect(screen.getByTestId('voice-note-waveform')).toBeTruthy();
    rerender(<VoiceNotePlayer message={voiceMessage('READY')} isOwn />);
    expect(screen.getByTestId('voice-note-waveform')).toBeTruthy();
  });
});