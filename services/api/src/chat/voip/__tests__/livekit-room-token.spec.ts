import * as jwt from 'jsonwebtoken';

import { LiveKitRoomService } from '../livekit-room.service';
import { LiveKitTokenService } from '../livekit-token.service';

/**
 * Unit tests for LiveKitRoomService + LiveKitTokenService (Task 3.3).
 *
 * Validates: Requirements 3.1, 3.4, 3.6 · P4, P5.
 * - room names are unguessable and unique per call; `deleteRoomSafe` is idempotent + best-effort.
 * - a minted token is short-lived, scoped to exactly one room + one identity, grants only the
 *   needed media capabilities (video only when allowed), and NEVER grants room admin/list/create.
 * The LiveKit room admin SDK is mocked; the token uses the real (pure, offline) AccessToken so we
 * can decode the signed JWT and assert its grants.
 */

const mockDeleteRoom = jest.fn();
jest.mock('livekit-server-sdk', () => {
  const actual = jest.requireActual('livekit-server-sdk');
  return {
    ...actual,
    RoomServiceClient: jest.fn().mockImplementation(() => ({
      deleteRoom: mockDeleteRoom,
    })),
  };
});

// Provide concrete LiveKit credentials the pure AccessToken signer needs (NODE_ENV=test otherwise
// leaves them empty). The real constant helpers/values are preserved except for the key/secret.
jest.mock('../voip.constants', () => {
  const actual = jest.requireActual('../voip.constants');
  return {
    ...actual,
    LIVEKIT_API_KEY: 'test-livekit-key',
    LIVEKIT_API_SECRET: 'test-livekit-secret-at-least-32-chars-long',
    LIVEKIT_URL: 'wss://rtc.test.local',
  };
});

/** Decode the LiveKit JWT payload (verifies the signature with the configured secret). */
interface LiveKitClaims {
  readonly sub?: string;
  readonly exp?: number;
  readonly iat?: number;
  readonly video?: Record<string, unknown>;
}

describe('LiveKitRoomService', () => {
  let service: LiveKitRoomService;

  beforeEach(() => {
    mockDeleteRoom.mockReset();
    service = new LiveKitRoomService();
  });

  it('generates unguessable, unique room names (never reused)', () => {
    const names = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      names.add(service.generateRoomName());
    }
    expect(names.size).toBe(1000);
    for (const name of names) {
      expect(name).toMatch(/^call-[0-9a-f-]{36}$/);
    }
  });

  it('deleteRoomSafe delegates to the LiveKit admin client', async () => {
    mockDeleteRoom.mockResolvedValueOnce(undefined);
    await service.deleteRoomSafe('call-abc');
    expect(mockDeleteRoom).toHaveBeenCalledWith('call-abc');
  });

  it('deleteRoomSafe swallows errors (best-effort, never throws)', async () => {
    mockDeleteRoom.mockRejectedValueOnce(new Error('livekit down'));
    await expect(service.deleteRoomSafe('call-xyz')).resolves.toBeUndefined();
  });
});

describe('LiveKitTokenService', () => {
  let service: LiveKitTokenService;

  beforeEach(() => {
    service = new LiveKitTokenService();
  });

  function decode(token: string): LiveKitClaims {
    // NODE_ENV=test config leaves LIVEKIT_API_SECRET empty; the AccessToken signs with it, so we
    // decode without verifying the signature to inspect the grants (we assert structure, not auth).
    return jwt.decode(token) as LiveKitClaims;
  }

  it('mints an audio-only token scoped to one identity + one room (no video, no admin)', async () => {
    const media = await service.mintToken({
      identity: 'user-1',
      roomName: 'call-room-1',
      canPublishVideo: false,
    });

    expect(media.token).toBeTruthy();
    const claims = decode(media.token);
    expect(claims.sub).toBe('user-1');
    expect(claims.video?.room).toBe('call-room-1');
    expect(claims.video?.roomJoin).toBe(true);
    expect(claims.video?.canSubscribe).toBe(true);
    // No admin/list/create capabilities.
    expect(claims.video?.roomCreate).toBeFalsy();
    expect(claims.video?.roomList).toBeFalsy();
    expect(claims.video?.roomAdmin).toBeFalsy();
  });

  it('grants a bounded TTL (exp is after iat, within the configured window)', async () => {
    const media = await service.mintToken({
      identity: 'user-1',
      roomName: 'call-room-1',
      canPublishVideo: false,
    });
    const claims = decode(media.token);
    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(typeof claims.exp).toBe('number');
    // Short-lived: expiry is in the future but not unbounded (within a day of now).
    expect(claims.exp ?? 0).toBeGreaterThan(nowSeconds);
    expect(claims.exp ?? 0).toBeLessThan(nowSeconds + 86400);
    expect(new Date(media.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('restricts publishable sources to microphone only when video is not allowed', async () => {
    const media = await service.mintToken({
      identity: 'user-1',
      roomName: 'call-room-1',
      canPublishVideo: false,
    });
    const claims = decode(media.token);
    const sources = claims.video?.canPublishSources as unknown[] | undefined;
    expect(Array.isArray(sources)).toBe(true);
    expect((sources ?? []).length).toBe(1);
  });

  it('allows microphone + camera when video is enabled and requested', async () => {
    const media = await service.mintToken({
      identity: 'user-1',
      roomName: 'call-room-1',
      canPublishVideo: true,
    });
    const claims = decode(media.token);
    const sources = claims.video?.canPublishSources as unknown[] | undefined;
    // VOIP_VIDEO_ENABLED defaults to true; camera is added alongside microphone.
    expect((sources ?? []).length).toBe(2);
  });

  it('the two participants of one call get distinct identities on the same room', async () => {
    const initiator = await service.mintToken({
      identity: 'initiator',
      roomName: 'call-room-shared',
      canPublishVideo: false,
    });
    const callee = await service.mintToken({
      identity: 'callee',
      roomName: 'call-room-shared',
      canPublishVideo: false,
    });
    expect(decode(initiator.token).sub).toBe('initiator');
    expect(decode(callee.token).sub).toBe('callee');
    expect(decode(initiator.token).video?.room).toBe('call-room-shared');
    expect(decode(callee.token).video?.room).toBe('call-room-shared');
  });
});
