import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { NegotiationRepository } from '../../negotiation/negotiation.repository';
import { ChatRepository, InsertMessageOutcome } from '../chat.repository';
import { ChatService, ChatRealtimePublisher } from '../chat.service';
import { ChatConversation } from '../entities/chat-conversation.entity';
import { ChatMessage } from '../entities/chat-message.entity';

/**
 * Unit tests for ChatService.
 *
 * Validates: Requirements 1.1, 1.3, 1.4, 2.2, 2.4, 2.5, 2.7 / P1, P3, P4, P5, P7, P15, P19.
 * Repositories and the realtime publisher are mocked so the orchestration is tested in isolation.
 */

function makeConversation(overrides: Partial<ChatConversation> = {}): ChatConversation {
  return {
    id: 'conv-1',
    threadId: 'thread-1',
    offerId: 'offer-1',
    hostId: 'host-1',
    cleanerId: 'cleaner-1',
    status: 'OPEN',
    messageSeq: 0,
    lastMessageAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    conversationId: 'conv-1',
    senderId: 'host-1',
    type: 'TEXT',
    body: 'hello',
    sequenceNumber: 1,
    clientMessageId: 'c1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('ChatService', () => {
  let chatRepo: jest.Mocked<Pick<ChatRepository, 'openOrGetConversationForThread' | 'findConversationById' | 'insertMessage' | 'closeConversationForThread' | 'getMessagesBefore' | 'getMessagesAfter' | 'listConversationsForUser'>>;
  let negotiationRepo: jest.Mocked<Pick<NegotiationRepository, 'findThreadById' | 'isThreadMatched'>>;
  let publisher: jest.Mocked<ChatRealtimePublisher>;
  let service: ChatService;

  beforeEach(() => {
    chatRepo = {
      openOrGetConversationForThread: jest.fn(),
      findConversationById: jest.fn(),
      insertMessage: jest.fn(),
      closeConversationForThread: jest.fn(),
      getMessagesBefore: jest.fn(),
      getMessagesAfter: jest.fn(),
      listConversationsForUser: jest.fn(),
    };
    negotiationRepo = {
      findThreadById: jest.fn(),
      isThreadMatched: jest.fn(),
    };
    publisher = { publish: jest.fn().mockResolvedValue(true) };
    service = new ChatService(
      chatRepo as unknown as ChatRepository,
      negotiationRepo as unknown as NegotiationRepository,
      publisher,
    );
  });

  describe('openConversation', () => {
    it('opens the conversation for a matched thread participant (P1)', async () => {
      negotiationRepo.findThreadById.mockResolvedValue({ id: 'thread-1', offerId: 'offer-1', hostId: 'host-1', cleanerId: 'cleaner-1' } as never);
      negotiationRepo.isThreadMatched.mockResolvedValue(true);
      chatRepo.openOrGetConversationForThread.mockResolvedValue(makeConversation());

      const view = await service.openConversation({ threadId: 'thread-1', userId: 'host-1' });
      expect(view.id).toBe('conv-1');
    });

    it('rejects a non-participant with 403 (P3)', async () => {
      negotiationRepo.findThreadById.mockResolvedValue({ id: 'thread-1', offerId: 'offer-1', hostId: 'host-1', cleanerId: 'cleaner-1' } as never);
      await expect(
        service.openConversation({ threadId: 'thread-1', userId: 'stranger' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects when the thread has no match with 409 (P1)', async () => {
      negotiationRepo.findThreadById.mockResolvedValue({ id: 'thread-1', offerId: 'offer-1', hostId: 'host-1', cleanerId: 'cleaner-1' } as never);
      negotiationRepo.isThreadMatched.mockResolvedValue(false);
      await expect(
        service.openConversation({ threadId: 'thread-1', userId: 'host-1' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects an unknown thread with 404', async () => {
      negotiationRepo.findThreadById.mockResolvedValue(null);
      await expect(
        service.openConversation({ threadId: 'nope', userId: 'host-1' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('sendMessage', () => {
    beforeEach(() => {
      chatRepo.findConversationById.mockResolvedValue(makeConversation());
    });

    it('persists then publishes best-effort (P4)', async () => {
      chatRepo.insertMessage.mockResolvedValue({ kind: 'inserted', message: makeMessage() } as InsertMessageOutcome);
      const result = await service.sendMessage('conv-1', 'host-1', 'c1', 'hello');
      expect(result.deduplicated).toBe(false);
      expect(chatRepo.insertMessage).toHaveBeenCalled();
      expect(publisher.publish).toHaveBeenCalledTimes(1);
      // persist happens before publish
      const insertOrder = chatRepo.insertMessage.mock.invocationCallOrder[0] ?? 0;
      const publishOrder = publisher.publish.mock.invocationCallOrder[0] ?? 0;
      expect(insertOrder).toBeLessThan(publishOrder);
    });

    it('does not publish for an idempotent duplicate (P5)', async () => {
      chatRepo.insertMessage.mockResolvedValue({ kind: 'duplicate', message: makeMessage() } as InsertMessageOutcome);
      const result = await service.sendMessage('conv-1', 'host-1', 'c1', 'hello');
      expect(result.deduplicated).toBe(true);
      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it('maps payload-mismatch conflict to 409 (P5)', async () => {
      chatRepo.insertMessage.mockResolvedValue({ kind: 'conflict' } as InsertMessageOutcome);
      await expect(service.sendMessage('conv-1', 'host-1', 'c1', 'changed')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('maps a closed conversation to 409', async () => {
      chatRepo.insertMessage.mockResolvedValue({ kind: 'closed' } as InsertMessageOutcome);
      await expect(service.sendMessage('conv-1', 'host-1', 'c1', 'hi')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rejects an empty body with 400 and never persists (P7)', async () => {
      await expect(service.sendMessage('conv-1', 'host-1', 'c1', '   ')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(chatRepo.insertMessage).not.toHaveBeenCalled();
    });

    it('rejects an oversized body with 400 and never persists (P7)', async () => {
      const huge = 'x'.repeat(100_000);
      await expect(service.sendMessage('conv-1', 'host-1', 'c1', huge)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(chatRepo.insertMessage).not.toHaveBeenCalled();
    });

    it('does not throw when publish fails (P4/P19 best-effort)', async () => {
      chatRepo.insertMessage.mockResolvedValue({ kind: 'inserted', message: makeMessage() } as InsertMessageOutcome);
      publisher.publish.mockRejectedValue(new Error('centrifugo down'));
      await expect(service.sendMessage('conv-1', 'host-1', 'c1', 'hello')).resolves.toMatchObject({
        deduplicated: false,
      });
    });

    it('rejects a non-participant sender with 403 (P3)', async () => {
      await expect(service.sendMessage('conv-1', 'stranger', 'c1', 'hi')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
