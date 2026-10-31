import { DataSource } from 'typeorm';

import { ChatRepository } from '../chat.repository';
import { InMemoryChatDataSource } from './support/in-memory-chat-data-source';

/**
 * Unit tests for ChatRepository against a behavioral in-memory DataSource.
 *
 * Validates the send-path invariants (P2 idempotent open, P5 dedup/conflict, P6 sequence order,
 * P8 keyset both cursors, P16 atomic summary, P17 OPEN-check under lock) without a live Postgres.
 */

function makeRepo(): { repo: ChatRepository; db: InMemoryChatDataSource } {
  const db = new InMemoryChatDataSource();
  const repo = new ChatRepository(db as unknown as DataSource);
  return { repo, db };
}

const OPEN_PARAMS = {
  threadId: 'thread-1',
  offerId: 'offer-1',
  hostId: 'host-1',
  cleanerId: 'cleaner-1',
};

describe('ChatRepository.openOrGetConversationForThread', () => {
  it('creates one conversation and returns the same on repeat (P2)', async () => {
    const { repo, db } = makeRepo();
    const first = await repo.openOrGetConversationForThread(OPEN_PARAMS);
    const second = await repo.openOrGetConversationForThread(OPEN_PARAMS);
    expect(first.id).toBe(second.id);
    expect(db.conversations).toHaveLength(1);
  });
});

describe('ChatRepository.insertMessage', () => {
  async function openConversation(repo: ChatRepository): Promise<string> {
    const conv = await repo.openOrGetConversationForThread(OPEN_PARAMS);
    return conv.id;
  }

  it('assigns strictly increasing sequence numbers (P6) and bumps last_message_at (P16)', async () => {
    const { repo, db } = makeRepo();
    const conversationId = await openConversation(repo);

    const a = await repo.insertMessage({ conversationId, senderId: 'host-1', clientMessageId: 'c1', body: 'hi' });
    const b = await repo.insertMessage({ conversationId, senderId: 'cleaner-1', clientMessageId: 'c2', body: 'yo' });

    expect(a.kind).toBe('inserted');
    expect(b.kind).toBe('inserted');
    if (a.kind === 'inserted' && b.kind === 'inserted') {
      expect(a.message.sequenceNumber).toBe(1);
      expect(b.message.sequenceNumber).toBe(2);
    }
    expect(db.conversations[0]?.last_message_at).toBeInstanceOf(Date);
    expect(db.conversations[0]?.message_seq).toBe(2);
  });

  it('is idempotent for the same clientMessageId + identical body (P5)', async () => {
    const { repo, db } = makeRepo();
    const conversationId = await openConversation(repo);
    await repo.insertMessage({ conversationId, senderId: 'host-1', clientMessageId: 'dup', body: 'once' });
    const again = await repo.insertMessage({ conversationId, senderId: 'host-1', clientMessageId: 'dup', body: 'once' });
    expect(again.kind).toBe('duplicate');
    expect(db.messages).toHaveLength(1);
  });

  it('returns conflict for the same clientMessageId + different body (P5)', async () => {
    const { repo, db } = makeRepo();
    const conversationId = await openConversation(repo);
    await repo.insertMessage({ conversationId, senderId: 'host-1', clientMessageId: 'dup', body: 'first' });
    const conflict = await repo.insertMessage({ conversationId, senderId: 'host-1', clientMessageId: 'dup', body: 'changed' });
    expect(conflict.kind).toBe('conflict');
    expect(db.messages).toHaveLength(1);
  });

  it('rejects sends to a CLOSED conversation (P17) and persists nothing', async () => {
    const { repo, db } = makeRepo();
    const conversationId = await openConversation(repo);
    await repo.closeConversationForThread('thread-1');
    const outcome = await repo.insertMessage({ conversationId, senderId: 'host-1', clientMessageId: 'x', body: 'hi' });
    expect(outcome.kind).toBe('closed');
    expect(db.messages).toHaveLength(0);
  });

  it('returns not_found for an unknown conversation', async () => {
    const { repo } = makeRepo();
    const outcome = await repo.insertMessage({ conversationId: 'nope', senderId: 'host-1', clientMessageId: 'x', body: 'hi' });
    expect(outcome.kind).toBe('not_found');
  });
});

describe('ChatRepository keyset history (P8)', () => {
  async function seed(repo: ChatRepository): Promise<string> {
    const conv = await repo.openOrGetConversationForThread(OPEN_PARAMS);
    for (let i = 1; i <= 5; i += 1) {
      await repo.insertMessage({
        conversationId: conv.id,
        senderId: 'host-1',
        clientMessageId: `c${i}`,
        body: `m${i}`,
      });
    }
    return conv.id;
  }

  it('before=null returns the latest page newest-first', async () => {
    const { repo } = makeRepo();
    const conversationId = await seed(repo);
    const page = await repo.getMessagesBefore(conversationId, null, 3);
    expect(page.map((m) => m.sequenceNumber)).toEqual([5, 4, 3]);
  });

  it('before=<seq> returns the immediately older page', async () => {
    const { repo } = makeRepo();
    const conversationId = await seed(repo);
    const page = await repo.getMessagesBefore(conversationId, 3, 10);
    expect(page.map((m) => m.sequenceNumber)).toEqual([2, 1]);
  });

  it('after=<seq> returns newer messages oldest-first (reconnect reconciliation)', async () => {
    const { repo } = makeRepo();
    const conversationId = await seed(repo);
    const page = await repo.getMessagesAfter(conversationId, 3, 10);
    expect(page.map((m) => m.sequenceNumber)).toEqual([4, 5]);
  });
});

describe('ChatRepository.isParticipant + inbox', () => {
  it('recognizes both participants and rejects a stranger', async () => {
    const { repo } = makeRepo();
    const conv = await repo.openOrGetConversationForThread(OPEN_PARAMS);
    expect(await repo.isParticipant('host-1', conv.id)).toBe(true);
    expect(await repo.isParticipant('cleaner-1', conv.id)).toBe(true);
    expect(await repo.isParticipant('stranger', conv.id)).toBe(false);
  });

  it('lists the user conversations ordered by recent activity with a preview', async () => {
    const { repo } = makeRepo();
    const conv = await repo.openOrGetConversationForThread(OPEN_PARAMS);
    await repo.insertMessage({ conversationId: conv.id, senderId: 'host-1', clientMessageId: 'c1', body: 'latest' });
    const inbox = await repo.listConversationsForUser('cleaner-1', 20);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.last_message_preview).toBe('latest');
  });
});
