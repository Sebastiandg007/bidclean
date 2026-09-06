import { UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

import { LiveKitWebhookController } from '../livekit-webhook.controller';
import { VoipRepository, VoipCallRow } from '../voip.repository';
import { CallStatus, EndReason, MediaKind } from '../voip.constants';

/**
 * Unit tests for LiveKitWebhookController (Task 7.2).
 *
 * Validates: Requirements 4.2, 4.4 · P12, P13.
 * - valid signature is accepted; a bad/missing signature → 401 with NO mutation;
 * - join/leave/room_started bump `last_media_activity_at`;
 * - `room_finished` cause interpretation: an error close → FAILED/ERROR (single-winner); a benign/
 *   ambiguous close → deferred to the sweep (no mutation here); an unknown/terminal room → no-op.
 * The LiveKit WebhookReceiver is mocked so we control the auth outcome + parsed event without a
 * real signature; the repo + publisher are mocked.
 */

const mockReceive = jest.fn();
jest.mock('livekit-server-sdk', () => {
  const actual = jest.requireActual('livekit-server-sdk');
  return {
    ...actual,
    WebhookReceiver: jest.fn().mockImplementation(() => ({ receive: mockReceive })),
  };
});

jest.mock('../voip.constants', () => {
  const actual = jest.requireActual('../voip.constants');
  return {
    ...actual,
    LIVEKIT_API_KEY: 'wh-key',
    LIVEKIT_API_SECRET: 'wh-secret-at-least-32-chars-long-padding',
  };
});

function rawReq(body: string): Request {
  return { rawBody: Buffer.from(body, 'utf8') } as unknown as Request;
}

function ongoingRow(overrides: Partial<VoipCallRow> = {}): VoipCallRow {
  return {
    id: 'call-1',
    conversation_id: 'conv-1',
    offer_id: 'offer-1',
    initiator_id: 'user-a',
    callee_id: 'user-b',
    media_kind: MediaKind.AUDIO,
    room_name: 'call-room-1',
    status: CallStatus.ONGOING,
    end_reason: null,
    client_call_id: 'ccid-1',
    initiated_at: new Date(),
    answered_at: new Date(),
    ended_at: null,
    last_media_activity_at: null,
    duration_seconds: null,
    ...overrides,
  };
}

function build(): {
  controller: LiveKitWebhookController;
  repo: jest.Mocked<Partial<VoipRepository>>;
  publisher: { publish: jest.Mock };
} {
  const repo: jest.Mocked<Partial<VoipRepository>> = {
    touchMediaActivity: jest.fn(async () => undefined),
    findByRoomName: jest.fn(async () => null),
    transitionTerminal: jest.fn(async () => null),
  };
  const publisher = { publish: jest.fn(async () => true) };
  const controller = new LiveKitWebhookController(
    repo as VoipRepository,
    publisher as never,
  );
  return { controller, repo, publisher };
}

beforeEach(() => {
  mockReceive.mockReset();
});

describe('LiveKitWebhookController — authentication', () => {
  it('rejects a missing Authorization header with 401 and no mutation', async () => {
    const { controller, repo } = build();
    await expect(controller.handle(rawReq('{}'), undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(repo.touchMediaActivity).not.toHaveBeenCalled();
  });

  it('rejects a bad/tampered signature with 401 and no mutation', async () => {
    const { controller, repo } = build();
    mockReceive.mockRejectedValueOnce(new Error('invalid signature'));
    await expect(controller.handle(rawReq('{}'), 'bad-jwt')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(repo.touchMediaActivity).not.toHaveBeenCalled();
    expect(repo.transitionTerminal).not.toHaveBeenCalled();
  });

  it('rejects a missing raw body with 401', async () => {
    const { controller } = build();
    await expect(
      controller.handle({} as unknown as Request, 'jwt'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('LiveKitWebhookController — liveness bumps', () => {
  it('bumps media activity on participant_joined', async () => {
    const { controller, repo } = build();
    mockReceive.mockResolvedValueOnce({
      event: 'participant_joined',
      room: { name: 'call-room-1' },
      createdAt: 1_700_000_000,
    });
    await controller.handle(rawReq('{}'), 'jwt');
    expect(repo.touchMediaActivity).toHaveBeenCalledWith('call-room-1', expect.any(Date));
  });

  it('bumps media activity on participant_left and room_started', async () => {
    const { controller, repo } = build();
    mockReceive.mockResolvedValueOnce({ event: 'participant_left', room: { name: 'r' } });
    await controller.handle(rawReq('{}'), 'jwt');
    mockReceive.mockResolvedValueOnce({ event: 'room_started', room: { name: 'r' } });
    await controller.handle(rawReq('{}'), 'jwt');
    expect(repo.touchMediaActivity).toHaveBeenCalledTimes(2);
  });

  it('ignores an event without room context (idempotent no-op)', async () => {
    const { controller, repo } = build();
    mockReceive.mockResolvedValueOnce({ event: 'egress_started' });
    const result = await controller.handle(rawReq('{}'), 'jwt');
    expect(result).toEqual({ received: true });
    expect(repo.touchMediaActivity).not.toHaveBeenCalled();
  });
});

describe('LiveKitWebhookController — room_finished cause interpretation (P13)', () => {
  it('a benign/ambiguous close of an ONGOING call is deferred to the sweep (no mutation)', async () => {
    const { controller, repo } = build();
    (repo.findByRoomName as jest.Mock).mockResolvedValueOnce(ongoingRow());
    // roomEndReason 2 = ROOM_END_IDLE_TIMEOUT (benign).
    mockReceive.mockResolvedValueOnce({
      event: 'room_finished',
      room: { name: 'call-room-1' },
      roomEndReason: 2,
    });
    await controller.handle(rawReq('{}'), 'jwt');
    expect(repo.transitionTerminal).not.toHaveBeenCalled();
  });

  it('an explicit error close (open_failed) of an ONGOING call → FAILED/ERROR (single-winner)', async () => {
    const { controller, repo, publisher } = build();
    (repo.findByRoomName as jest.Mock).mockResolvedValueOnce(ongoingRow());
    (repo.transitionTerminal as jest.Mock).mockResolvedValueOnce(
      ongoingRow({ status: CallStatus.FAILED, end_reason: EndReason.ERROR, duration_seconds: 3 }),
    );
    // roomEndReason 5 = ROOM_END_OPEN_FAILED (error).
    mockReceive.mockResolvedValueOnce({
      event: 'room_finished',
      room: { name: 'call-room-1' },
      roomEndReason: 5,
    });
    await controller.handle(rawReq('{}'), 'jwt');
    expect(repo.transitionTerminal).toHaveBeenCalledWith(
      'call-1',
      CallStatus.ONGOING,
      CallStatus.FAILED,
      EndReason.ERROR,
    );
    expect(publisher.publish).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ type: 'call_end', endReason: EndReason.ERROR }),
    );
  });

  it('room_finished for an unknown / non-ONGOING room is an idempotent no-op', async () => {
    const { controller, repo } = build();
    (repo.findByRoomName as jest.Mock).mockResolvedValueOnce(null);
    mockReceive.mockResolvedValueOnce({
      event: 'room_finished',
      room: { name: 'gone' },
      roomEndReason: 5,
    });
    const result = await controller.handle(rawReq('{}'), 'jwt');
    expect(result).toEqual({ received: true });
    expect(repo.transitionTerminal).not.toHaveBeenCalled();
  });
});
