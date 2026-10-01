import { ConflictException, ForbiddenException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

import { VoipService } from '../voip.service';
import { VoipRepository, VoipCallRow } from '../voip.repository';
import { LiveKitRoomService } from '../livekit-room.service';
import { LiveKitTokenService } from '../livekit-token.service';
import { CallStatus, MediaKind } from '../voip.constants';
import { MediaToken } from '../voip.types';

/**
 * Unit tests for VoipService (Task 5.2).
 *
 * Validates: Requirements 1.1, 1.4, 1.5, 1.6, 2.1, 2.7, 3.2 · P2, P3, P4, P8, P10.
 * - participant/OPEN gates (403/409);
 * - dedup returns the existing call, a DB unique violation → 409 busy;
 * - the status+role token matrix (callee blocked while RINGING except via answer; terminal → no
 *   token; the room is always resolved from the DB, never the client);
 * - single-winner end (a lost race returns the current state, no double publish);
 * - a best-effort publish failure never fails the request.
 */

const HOST = 'user-host';
const CLEANER = 'user-cleaner';
const CONV = 'conv-1';
const CALL = 'call-1';
const ROOM = 'call-room-1';

const SAMPLE_TOKEN: MediaToken = {
  livekitUrl: 'wss://rtc.test.local',
  token: 'signed.jwt.token',
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
};

interface Conversation {
  id: string;
  offerId: string;
  hostId: string | null;
  cleanerId: string | null;
  status: string;
}

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return { id: CONV, offerId: 'offer-1', hostId: HOST, cleanerId: CLEANER, status: 'OPEN', ...overrides };
}

function callRow(overrides: Partial<VoipCallRow> = {}): VoipCallRow {
  return {
    id: CALL,
    conversation_id: CONV,
    offer_id: 'offer-1',
    initiator_id: HOST,
    callee_id: CLEANER,
    media_kind: MediaKind.AUDIO,
    room_name: ROOM,
    status: CallStatus.RINGING,
    end_reason: null,
    client_call_id: 'ccid-1',
    initiated_at: new Date(),
    answered_at: null,
    ended_at: null,
    last_media_activity_at: null,
    duration_seconds: null,
    ...overrides,
  };
}

/** A fake DataSource whose transaction() calls back with a manager, and whose repo(...) findOne is stubbed. */
function buildDataSource(conv: Conversation | null): {
  ds: {
    transaction: jest.Mock;
    getRepository: jest.Mock;
  };
  managerQuery: jest.Mock;
} {
  const managerQuery = jest.fn(async (sql: string) => {
    if (sql.includes('FOR UPDATE')) {
      return conv ? [conv] : [];
    }
    return [];
  });
  const ds = {
    transaction: jest.fn(async (cb: (m: unknown) => Promise<unknown>) =>
      cb({ query: managerQuery }),
    ),
    getRepository: jest.fn(() => ({
      findOne: jest.fn(async () => conv),
    })),
  };
  return { ds, managerQuery };
}

function buildService(conv: Conversation | null = conversation()): {
  service: VoipService;
  repo: jest.Mocked<Partial<VoipRepository>>;
  publisher: { publish: jest.Mock };
  room: jest.Mocked<Partial<LiveKitRoomService>>;
  token: jest.Mocked<Partial<LiveKitTokenService>>;
} {
  const { ds } = buildDataSource(conv);
  const repo: jest.Mocked<Partial<VoipRepository>> = {
    findConsumableByClientCallId: jest.fn(async () => null),
    insertRinging: jest.fn(async () => callRow()),
    findActiveForConversation: jest.fn(async () => null),
    findById: jest.fn(async () => callRow()),
    answer: jest.fn(async () => callRow({ status: CallStatus.ONGOING, answered_at: new Date() })),
    transitionTerminal: jest.fn(async () => callRow({ status: CallStatus.ENDED })),
    forceEndForConversation: jest.fn(async () => []),
    listForConversation: jest.fn(async () => []),
  };
  const room: jest.Mocked<Partial<LiveKitRoomService>> = {
    generateRoomName: jest.fn(() => ROOM),
    deleteRoomSafe: jest.fn(async () => undefined),
  };
  const token: jest.Mocked<Partial<LiveKitTokenService>> = {
    mintToken: jest.fn(async () => SAMPLE_TOKEN),
  };
  const publisher = { publish: jest.fn(async () => true) };

  const service = new VoipService(
    ds as never,
    repo as VoipRepository,
    room as LiveKitRoomService,
    token as LiveKitTokenService,
    publisher as never,
  );
  return { service, repo, publisher, room, token };
}

describe('VoipService.initiate', () => {
  it('persists RINGING then mints the initiator token then publishes call_invite (durable-first)', async () => {
    const { service, repo, token, publisher } = buildService();
    const result = await service.initiate({
      conversationId: CONV,
      callerId: HOST,
      clientCallId: 'ccid-1',
      mediaKind: MediaKind.AUDIO,
    });

    expect(repo.insertRinging).toHaveBeenCalledTimes(1);
    expect(token.mintToken).toHaveBeenCalledWith(
      expect.objectContaining({ identity: HOST, roomName: ROOM }),
    );
    expect(result.call.status).toBe(CallStatus.RINGING);
    expect(result.roomName).toBe(ROOM);
    expect(result.media.token).toBe(SAMPLE_TOKEN.token);
    // call_invite published best-effort.
    expect(publisher.publish).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ type: 'call_invite', callId: CALL }),
    );
  });

  it('rejects a non-participant with 403 and persists nothing', async () => {
    const { service, repo } = buildService();
    await expect(
      service.initiate({
        conversationId: CONV,
        callerId: 'stranger',
        clientCallId: 'ccid-1',
        mediaKind: MediaKind.AUDIO,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.insertRinging).not.toHaveBeenCalled();
  });

  it('rejects initiate on a CLOSED conversation with 409', async () => {
    const { service, repo } = buildService(conversation({ status: 'CLOSED' }));
    await expect(
      service.initiate({
        conversationId: CONV,
        callerId: HOST,
        clientCallId: 'ccid-1',
        mediaKind: MediaKind.AUDIO,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.insertRinging).not.toHaveBeenCalled();
  });

  it('is idempotent: the same clientCallId returns the existing call without a second insert', async () => {
    const { service, repo, publisher } = buildService();
    (repo.findConsumableByClientCallId as jest.Mock).mockResolvedValueOnce(
      callRow({ status: CallStatus.RINGING }),
    );
    const result = await service.initiate({
      conversationId: CONV,
      callerId: HOST,
      clientCallId: 'ccid-1',
      mediaKind: MediaKind.AUDIO,
    });
    expect(repo.insertRinging).not.toHaveBeenCalled();
    expect(result.call.id).toBe(CALL);
    // A dedup does not re-publish an invite.
    expect(publisher.publish).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ type: 'call_invite' }),
    );
  });

  it('maps a unique-violation (concurrent second active call) to 409 busy + minimal call_busy', async () => {
    const { service, repo, publisher } = buildService();
    const uniqueError = new QueryFailedError('q', [], new Error('dup'));
    (uniqueError as unknown as { code: string }).code = '23505';
    (repo.insertRinging as jest.Mock).mockRejectedValueOnce(uniqueError);
    (repo.findActiveForConversation as jest.Mock).mockResolvedValueOnce(
      callRow({ id: 'existing', status: CallStatus.ONGOING }),
    );

    await expect(
      service.initiate({
        conversationId: CONV,
        callerId: HOST,
        clientCallId: 'ccid-2',
        mediaKind: MediaKind.AUDIO,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(publisher.publish).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ type: 'call_busy', callId: 'existing' }),
    );
    // The busy signal reveals nothing beyond the callId.
    const busyCall = publisher.publish.mock.calls.find(
      (c) => (c[1] as { type?: string }).type === 'call_busy',
    );
    expect(Object.keys(busyCall?.[1] as object).sort()).toEqual(['callId', 'type']);
  });

  it('does not fail initiate when the best-effort publish throws', async () => {
    const { service, publisher } = buildService();
    publisher.publish.mockRejectedValue(new Error('centrifugo down'));
    await expect(
      service.initiate({
        conversationId: CONV,
        callerId: HOST,
        clientCallId: 'ccid-1',
        mediaKind: MediaKind.AUDIO,
      }),
    ).resolves.toMatchObject({ call: { status: CallStatus.RINGING } });
  });
});

describe('VoipService.answer', () => {
  it('answers as the callee, single-winner RINGING→ONGOING, mints the callee token', async () => {
    const { service, repo, token } = buildService();
    (repo.findById as jest.Mock).mockResolvedValue(callRow({ callee_id: CLEANER }));
    const media = await service.answer(CONV, CALL, CLEANER);
    expect(repo.answer).toHaveBeenCalledWith(CALL);
    expect(token.mintToken).toHaveBeenCalledWith(
      expect.objectContaining({ identity: CLEANER, roomName: ROOM }),
    );
    expect(media.token).toBe(SAMPLE_TOKEN.token);
  });

  it('rejects an answer from the initiator (wrong role) with 403', async () => {
    const { service, repo } = buildService();
    (repo.findById as jest.Mock).mockResolvedValue(callRow({ initiator_id: HOST, callee_id: CLEANER }));
    await expect(service.answer(CONV, CALL, HOST)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects answering an already-answered/terminal call with 409 (rows=0)', async () => {
    const { service, repo } = buildService();
    (repo.findById as jest.Mock).mockResolvedValue(callRow({ callee_id: CLEANER }));
    (repo.answer as jest.Mock).mockResolvedValueOnce(null);
    await expect(service.answer(CONV, CALL, CLEANER)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('VoipService.mintMediaToken — status+role gate', () => {
  it('RINGING → initiator gets a token', async () => {
    const { service, repo, token } = buildService();
    (repo.findById as jest.Mock).mockResolvedValue(callRow({ status: CallStatus.RINGING, initiator_id: HOST }));
    await service.mintMediaToken(CONV, CALL, HOST);
    expect(token.mintToken).toHaveBeenCalledWith(expect.objectContaining({ roomName: ROOM }));
  });

  it('RINGING → callee is DENIED a bare token (must use answer)', async () => {
    const { service, repo, token } = buildService();
    (repo.findById as jest.Mock).mockResolvedValue(callRow({ status: CallStatus.RINGING, callee_id: CLEANER }));
    await expect(service.mintMediaToken(CONV, CALL, CLEANER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(token.mintToken).not.toHaveBeenCalled();
  });

  it('ONGOING → either participant gets a token (rejoin path)', async () => {
    const { service, repo, token } = buildService();
    (repo.findById as jest.Mock).mockResolvedValue(callRow({ status: CallStatus.ONGOING }));
    await service.mintMediaToken(CONV, CALL, CLEANER);
    expect(token.mintToken).toHaveBeenCalled();
  });

  it('terminal → no token for anyone (409)', async () => {
    const { service, repo, token } = buildService();
    (repo.findById as jest.Mock).mockResolvedValue(callRow({ status: CallStatus.ENDED }));
    await expect(service.mintMediaToken(CONV, CALL, HOST)).rejects.toBeInstanceOf(ConflictException);
    expect(token.mintToken).not.toHaveBeenCalled();
  });

  it('the room is always resolved from the DB, never from the caller', async () => {
    const { service, repo, token } = buildService();
    (repo.findById as jest.Mock).mockResolvedValue(callRow({ status: CallStatus.ONGOING, room_name: 'db-room' }));
    await service.mintMediaToken(CONV, CALL, HOST);
    expect(token.mintToken).toHaveBeenCalledWith(expect.objectContaining({ roomName: 'db-room' }));
  });

  it('a non-participant is denied (403) and learns nothing about the call', async () => {
    const { service } = buildService(conversation());
    await expect(service.mintMediaToken(CONV, CALL, 'stranger')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('VoipService.end — single-winner', () => {
  it('ends an ONGOING call, deriving duration once and publishing call_end', async () => {
    const { service, repo, publisher } = buildService();
    (repo.findById as jest.Mock).mockResolvedValue(callRow({ status: CallStatus.ONGOING, answered_at: new Date() }));
    (repo.transitionTerminal as jest.Mock).mockResolvedValueOnce(
      callRow({ status: CallStatus.ENDED, duration_seconds: 42, ended_at: new Date() }),
    );
    const view = await service.end(CONV, CALL, HOST);
    expect(view.status).toBe(CallStatus.ENDED);
    expect(view.durationSeconds).toBe(42);
    expect(publisher.publish).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ type: 'call_end', durationSeconds: 42 }),
    );
  });

  it('is an idempotent no-op on an already-terminal call (no publish, no re-derive)', async () => {
    const { service, repo, publisher } = buildService();
    (repo.findById as jest.Mock).mockResolvedValue(callRow({ status: CallStatus.ENDED, duration_seconds: 10 }));
    const view = await service.end(CONV, CALL, HOST);
    expect(view.status).toBe(CallStatus.ENDED);
    expect(repo.transitionTerminal).not.toHaveBeenCalled();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('a losing concurrent end returns the current state without publishing again', async () => {
    const { service, repo, publisher } = buildService();
    (repo.findById as jest.Mock)
      .mockResolvedValueOnce(callRow({ status: CallStatus.ONGOING, answered_at: new Date() }))
      .mockResolvedValueOnce(callRow({ status: CallStatus.ENDED, duration_seconds: 5 }));
    (repo.transitionTerminal as jest.Mock).mockResolvedValueOnce(null); // lost the race
    const view = await service.end(CONV, CALL, CLEANER);
    expect(view.status).toBe(CallStatus.ENDED);
    expect(publisher.publish).not.toHaveBeenCalled();
  });
});
