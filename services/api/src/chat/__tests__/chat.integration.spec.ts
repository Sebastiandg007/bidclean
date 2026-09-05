import {
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { NegotiationRepository } from '../../negotiation/negotiation.repository';
import { ChatRepository } from '../chat.repository';
import { ChatService, ChatRealtimePublisher } from '../chat.service';
import { InMemoryChatDataSource } from './support/in-memory-chat-data-source';

/**
 * Integration test — ChatService wired to the real ChatRepository over the in-memory DataSource,
 * with a mocked match lookup and a controllable publisher.
 *
 * Validates: Requirements 1.1, 1.4, 2.2, 2.5, 3.3, 3.4 / P1, P3, P4, P8, P9, P15, P17.
 */

const THREAD = { id: 'thread-1', offerId: 'offer-1', hostId: 'host-1', cleanerId: 'cleaner-1' };

function buildStack(): {
  service: ChatService;
  negotiation: jest.Mocked<Pick<NegotiationRepository, 'findThreadById' | 'isThreadMatched'>>;
  publisher: jest.Mocked<ChatRealtimePublisher>;
  chatRepo: ChatRepository;
} {
  const db = new InMemoryChatDataSource();
  const chatRepo = new ChatRepository(db as unknown as DataSource);
  const negotiation = {
    findThreadById: jest.fn().mockResolvedValue(THREAD),
    isThreadMatched: jest.fn().mockResolvedValue(true),
  };
  const publisher: jest.Mocked<ChatRealtimePublisher> = { publish: jest.fn().mockResolvedValue(true) };
  const service = new ChatService(
    chatRepo,
    negotiation as unknown as NegotiationRepository,
    publisher,
  );
  return { service, negotiation, publisher, chatRepo };
}

describe('Chat integration — match → open → send → history', () => {
  it('opens a conversation for a matched thread, sends, and reads it back in history (P1/P4/P9)', async () => {
    const { service } = buildStack();
    const conversation = await service.openConversation({ threadId: 'thread-1', userId: 'host-1' });

    const sent = await service.sendMessage(conversation.id, 'host-1', 'c1', 'hello there');
    expect(sent.deduplicated).toBe(false);
    expect(sent.message.sequenceNumber).toBe(1);

    const page = await service.getMessagesBefore(conversation.id, 'cleaner-1', null, 50);
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0]?.body).toBe('hello there');
  });

  it('reconciles newer messages via the after cursor (P9)', async () => {
    const { service } = buildStack();
    const conversation = await service.openConversation({ threadId: 'thread-1', userId: 'host-1' });
    await service.sendMessage(conversation.id, 'host-1', 'c1', 'one');
    await service.sendMessage(conversation.id, 'cleaner-1', 'c2', 'two');

    const after = await service.getMessagesAfter(conversation.id, 'host-1', 1, 50);
    expect(after.messages.map((m) => m.sequenceNumber)).toEqual([2]);
  });

  it('denies a non-participant reading the conversation (P3)', async () => {
    const { service } = buildStack();
    const conversation = await service.openConversation({ threadId: 'thread-1', userId: 'host-1' });
    await expect(service.getConversation(conversation.id, 'stranger')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects sends to a CLOSED conversation (P17)', async () => {
    const { service } = buildStack();
    const conversation = await service.openConversation({ threadId: 'thread-1', userId: 'host-1' });
    await service.closeConversationForThread('thread-1');
    await expect(
      service.sendMessage(conversation.id, 'host-1', 'c1', 'late'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('still persists (and history shows) a message when publish fails (P4/P15)', async () => {
    const { service, publisher } = buildStack();
    publisher.publish.mockRejectedValue(new Error('centrifugo down'));
    const conversation = await service.openConversation({ threadId: 'thread-1', userId: 'host-1' });

    const sent = await service.sendMessage(conversation.id, 'host-1', 'c1', 'resilient');
    expect(sent.deduplicated).toBe(false);

    const page = await service.getMessagesBefore(conversation.id, 'host-1', null, 50);
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0]?.body).toBe('resilient');
  });

  it('does not create a conversation for an unmatched thread (P1)', async () => {
    const { service, negotiation } = buildStack();
    negotiation.isThreadMatched.mockResolvedValue(false);
    await expect(
      service.openConversation({ threadId: 'thread-1', userId: 'host-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
