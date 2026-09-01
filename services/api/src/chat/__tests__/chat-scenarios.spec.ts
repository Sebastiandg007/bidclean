import { ConflictException, ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { NegotiationRepository } from '../../negotiation/negotiation.repository';
import { ChatRepository } from '../chat.repository';
import { ChatService, ChatRealtimePublisher } from '../chat.service';
import { InMemoryChatDataSource } from './support/in-memory-chat-data-source';

/**
 * Scenario/integration tests for the chat backend, complementing chat.integration.spec.ts.
 *
 * Covers:
 * - 15.2 authorization & lifecycle: unmatched thread has no conversation; a non-participant is
 *   denied read/write; match invalidation (offer-terminal) closes the conversation and blocks new
 *   sends while history stays readable.
 * - 15.3 transport resilience: a publish failure still persists (no message lost); after a
 *   "reconnect", the client reconciles the missed messages via the `after` cursor with no
 *   duplicates and correct order. There is no immediate-delivery guarantee — recovery is by
 *   reconciliation.
 */

const THREAD = { id: 'thread-1', offerId: 'offer-1', hostId: 'host-1', cleanerId: 'cleaner-1' };

function buildStack(): {
  service: ChatService;
  negotiation: { findThreadById: jest.Mock; isThreadMatched: jest.Mock };
  publisher: jest.Mocked<ChatRealtimePublisher>;
} {
  const db = new InMemoryChatDataSource();
  const chatRepo = new ChatRepository(db as unknown as DataSource);
  const negotiation = {
    findThreadById: jest.fn().mockResolvedValue(THREAD),
    isThreadMatched: jest.fn().mockResolvedValue(true),
  };
  const publisher: jest.Mocked<ChatRealtimePublisher> = {
    publish: jest.fn().mockResolvedValue(true),
  };
  const service = new ChatService(
    chatRepo,
    negotiation as unknown as NegotiationRepository,
    publisher,
  );
  return { service, negotiation, publisher };
}

describe('Chat scenario — authorization & lifecycle (15.2)', () => {
  it('does not open a conversation for an unmatched thread', async () => {
    const { service, negotiation } = buildStack();
    negotiation.isThreadMatched.mockResolvedValue(false);
    await expect(
      service.openConversation({ threadId: 'thread-1', userId: 'host-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('denies a non-participant read and write', async () => {
    const { service } = buildStack();
    const conversation = await service.openConversation({ threadId: 'thread-1', userId: 'host-1' });

    await expect(service.getConversation(conversation.id, 'stranger')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      service.sendMessage(conversation.id, 'stranger', 'c1', 'hi'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('offer-terminal close blocks new sends but keeps history readable', async () => {
    const { service } = buildStack();
    const conversation = await service.openConversation({ threadId: 'thread-1', userId: 'host-1' });
    await service.sendMessage(conversation.id, 'host-1', 'c1', 'before close');

    // Match invalidation via the offer-terminal path.
    await service.closeConversationsForOffer('offer-1');

    await expect(
      service.sendMessage(conversation.id, 'host-1', 'c2', 'after close'),
    ).rejects.toBeInstanceOf(ConflictException);

    const page = await service.getMessagesBefore(conversation.id, 'cleaner-1', null, 50);
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0]?.body).toBe('before close');
  });

  it('closing is idempotent (repeated close leaves history intact)', async () => {
    const { service } = buildStack();
    const conversation = await service.openConversation({ threadId: 'thread-1', userId: 'host-1' });
    await service.sendMessage(conversation.id, 'host-1', 'c1', 'kept');

    await service.closeConversationForThread('thread-1');
    await service.closeConversationForThread('thread-1');

    const page = await service.getMessagesBefore(conversation.id, 'host-1', null, 50);
    expect(page.messages).toHaveLength(1);
  });
});

describe('Chat scenario — transport resilience (15.3)', () => {
  it('persists the message and returns success even when publish throws (no loss)', async () => {
    const { service, publisher } = buildStack();
    publisher.publish.mockRejectedValue(new Error('centrifugo unreachable'));
    const conversation = await service.openConversation({ threadId: 'thread-1', userId: 'host-1' });

    const sent = await service.sendMessage(conversation.id, 'host-1', 'c1', 'survives');
    expect(sent.deduplicated).toBe(false);
    expect(sent.message.sequenceNumber).toBe(1);

    const page = await service.getMessagesBefore(conversation.id, 'host-1', null, 50);
    expect(page.messages.map((m) => m.body)).toEqual(['survives']);
  });

  it('a reconnecting client reconciles missed messages via the after cursor without duplicates', async () => {
    const { service } = buildStack();
    const conversation = await service.openConversation({ threadId: 'thread-1', userId: 'host-1' });

    // Client is "connected" and has seen the first message.
    await service.sendMessage(conversation.id, 'host-1', 'c1', 'seen');
    const firstPage = await service.getMessagesBefore(conversation.id, 'cleaner-1', null, 50);
    const lastSeen = firstPage.messages[firstPage.messages.length - 1]?.sequenceNumber ?? 0;

    // While "offline", more messages arrive.
    await service.sendMessage(conversation.id, 'host-1', 'c2', 'missed-1');
    await service.sendMessage(conversation.id, 'cleaner-1', 'c3', 'missed-2');

    // On reconnect, reconcile strictly after the last seen sequence.
    const reconciled = await service.getMessagesAfter(conversation.id, 'cleaner-1', lastSeen, 50);
    expect(reconciled.messages.map((m) => m.body)).toEqual(['missed-1', 'missed-2']);
    expect(reconciled.messages.every((m) => m.sequenceNumber > lastSeen)).toBe(true);
  });

  it('publish failure does not consume a sequence retry — resend with a new client id continues the order', async () => {
    const { service, publisher } = buildStack();
    const conversation = await service.openConversation({ threadId: 'thread-1', userId: 'host-1' });

    publisher.publish.mockRejectedValueOnce(new Error('flaky'));
    const first = await service.sendMessage(conversation.id, 'host-1', 'c1', 'one');
    const second = await service.sendMessage(conversation.id, 'host-1', 'c2', 'two');

    expect(first.message.sequenceNumber).toBe(1);
    expect(second.message.sequenceNumber).toBe(2);
  });
});
