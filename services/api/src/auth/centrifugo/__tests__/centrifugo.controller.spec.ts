import { ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';

import { ChatParticipationService } from '../../../chat/chat-participation.service';
import { User } from '../../entities/user.entity';
import { JwtUserPayload } from '../../guards/jwt.types';
import { CentrifugoController } from '../centrifugo.controller';
import { CentrifugoTokenService } from '../centrifugo-token.service';

/**
 * Unit tests for CentrifugoController.
 *
 * Validates: Requirements 4.1, 4.3, 4.4 / P3, P10. Identity is the authenticated subject; a
 * subscription token is issued only to a participant, resolved by lookup — never trusting the
 * channel string.
 */

interface RequestLike {
  user: JwtUserPayload;
}

function makeRequest(): RequestLike {
  return {
    user: {
      keycloakId: 'kc-1',
      email: 'u@example.com',
      emailVerified: true,
      sessionState: 'sess-1',
    },
  };
}

describe('CentrifugoController', () => {
  const tokenService = {
    mintConnectionToken: jest.fn().mockReturnValue('connection-token'),
    mintSubscriptionToken: jest.fn().mockReturnValue('subscription-token'),
  } as unknown as CentrifugoTokenService;

  const participation = {
    isParticipant: jest.fn(),
  } as unknown as ChatParticipationService;

  const userRepository = {
    findOne: jest.fn(),
  } as unknown as Repository<User>;

  const controller = new CentrifugoController(tokenService, participation, userRepository);

  beforeEach(() => {
    jest.clearAllMocks();
    (userRepository.findOne as jest.Mock).mockResolvedValue({ id: 'user-1' } as User);
  });

  it('returns a connection token when no channel is requested', async () => {
    const res = await controller.getToken(makeRequest() as never, undefined);
    expect(res.token).toBe('connection-token');
    expect(tokenService.mintConnectionToken).toHaveBeenCalledWith('user-1');
  });

  it('returns a subscription token for a participant of the requested channel', async () => {
    (participation.isParticipant as jest.Mock).mockResolvedValue(true);
    const res = await controller.getToken(
      makeRequest() as never,
      'chat:conversation:conv-9',
    );
    expect(res.token).toBe('subscription-token');
    expect(participation.isParticipant).toHaveBeenCalledWith('user-1', 'conv-9');
    expect(tokenService.mintSubscriptionToken).toHaveBeenCalledWith(
      'user-1',
      'chat:conversation:conv-9',
    );
  });

  it('denies a subscription token to a non-participant (403)', async () => {
    (participation.isParticipant as jest.Mock).mockResolvedValue(false);
    await expect(
      controller.getToken(makeRequest() as never, 'chat:conversation:conv-9'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tokenService.mintSubscriptionToken).not.toHaveBeenCalled();
  });

  it('denies a malformed channel that is not a chat conversation channel (403)', async () => {
    await expect(
      controller.getToken(makeRequest() as never, 'offers:cleaner:user-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(participation.isParticipant).not.toHaveBeenCalled();
  });

  it('rejects when the authenticated user cannot be resolved', async () => {
    (userRepository.findOne as jest.Mock).mockResolvedValue(null);
    await expect(controller.getToken(makeRequest() as never, undefined)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
