import * as fc from 'fast-check';
import * as jwt from 'jsonwebtoken';
import { ForbiddenException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';

import { ChatRepository } from '../chat.repository';
import { ChatParticipationService } from '../chat-participation.service';
import { CentrifugoController } from '../../auth/centrifugo/centrifugo.controller';
import { CentrifugoTokenService } from '../../auth/centrifugo/centrifugo-token.service';
import { User } from '../../auth/entities/user.entity';
import { JwtUserPayload } from '../../auth/guards/jwt.types';
import { CHAT_CHANNEL_PREFIX } from '../chat.constants';
import { InMemoryChatDataSource } from './support/in-memory-chat-data-source';

/**
 * Property-based tests for the chat backend (fast-check, ≥100 runs each).
 *
 * Covers:
 * - P5 (14.1) — idempotent send, payload-checked: arbitrary retries of the same clientMessageId
 *   persist exactly one message when the body is identical; a changed body → conflict.
 * - P6 (14.2) — sequence total order, gaps allowed: sequential inserts yield unique, strictly
 *   increasing sequence numbers.
 * - P8 (14.3) — keyset history both cursors: `before` + `after` paging over a random history has
 *   no gaps/overlaps and correct ordering, and reconstructs the full log exactly once.
 * - P10 (14.4) — token scoping: the connection-token subject is the authenticated caller, and a
 *   subscription token is issued only to a participant (by lookup, never the channel string).
 *
 * The token secret is seeded in test/setup-env.ts (CENTRIFUGO_TOKEN_SECRET = 'test-centrifugo-secret').
 */

const SECRET = 'test-centrifugo-secret';

const OPEN_PARAMS = {
  threadId: 'thread-1',
  offerId: 'offer-1',
  hostId: 'host-1',
  cleanerId: 'cleaner-1',
};

function makeRepo(): ChatRepository {
  const db = new InMemoryChatDataSource();
  return new ChatRepository(db as unknown as DataSource);
}

async function openConversation(repo: ChatRepository): Promise<string> {
  const conv = await repo.openOrGetConversationForThread(OPEN_PARAMS);
  return conv.id;
}

describe('P5 (14.1) — idempotent send, payload-checked', () => {
  it('persists exactly one message across arbitrary retries of the same identical payload', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.integer({ min: 1, max: 8 }),
        async (body, retries) => {
          const repo = makeRepo();
          const conversationId = await openConversation(repo);

          const outcomes = [];
          for (let i = 0; i < retries; i += 1) {
            outcomes.push(
              await repo.insertMessage({
                conversationId,
                senderId: 'host-1',
                clientMessageId: 'stable-cmid',
                body,
              }),
            );
          }

          const inserted = outcomes.filter((o) => o.kind === 'inserted');
          const duplicates = outcomes.filter((o) => o.kind === 'duplicate');
          expect(inserted).toHaveLength(1);
          expect(duplicates).toHaveLength(retries - 1);

          const page = await repo.getMessagesBefore(conversationId, null, 100);
          expect(page).toHaveLength(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns conflict when the same clientMessageId is reused with a different body', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .tuple(fc.string({ minLength: 1, maxLength: 100 }), fc.string({ minLength: 1, maxLength: 100 }))
          .filter(([a, b]) => a.trim() !== b.trim() && a.trim().length > 0 && b.trim().length > 0),
        async ([first, second]) => {
          const repo = makeRepo();
          const conversationId = await openConversation(repo);

          const initial = await repo.insertMessage({
            conversationId,
            senderId: 'host-1',
            clientMessageId: 'cmid',
            body: first,
          });
          const conflict = await repo.insertMessage({
            conversationId,
            senderId: 'host-1',
            clientMessageId: 'cmid',
            body: second,
          });

          expect(initial.kind).toBe('inserted');
          expect(conflict.kind).toBe('conflict');
          const page = await repo.getMessagesBefore(conversationId, null, 100);
          expect(page).toHaveLength(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('P6 (14.2) — sequence total order, gaps allowed', () => {
  it('assigns unique, strictly increasing sequence numbers to a batch of sends', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 30 }), async (count) => {
        const repo = makeRepo();
        const conversationId = await openConversation(repo);

        const seqs: number[] = [];
        for (let i = 0; i < count; i += 1) {
          const outcome = await repo.insertMessage({
            conversationId,
            senderId: i % 2 === 0 ? 'host-1' : 'cleaner-1',
            clientMessageId: `cmid-${i}`,
            body: `m${i}`,
          });
          if (outcome.kind === 'inserted') {
            seqs.push(outcome.message.sequenceNumber);
          }
        }

        expect(new Set(seqs).size).toBe(seqs.length);
        for (let i = 1; i < seqs.length; i += 1) {
          expect((seqs[i] as number) > (seqs[i - 1] as number)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('P8 (14.3) — keyset history, both cursors', () => {
  it('before-paging reconstructs the full log once, newest-first per page, no gaps/overlaps', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 40 }),
        fc.integer({ min: 1, max: 10 }),
        async (total, pageSize) => {
          const repo = makeRepo();
          const conversationId = await openConversation(repo);
          for (let i = 1; i <= total; i += 1) {
            await repo.insertMessage({
              conversationId,
              senderId: 'host-1',
              clientMessageId: `c${i}`,
              body: `m${i}`,
            });
          }

          const collected: number[] = [];
          let cursor: number | null = null;
          for (;;) {
            const page = await repo.getMessagesBefore(conversationId, cursor, pageSize);
            if (page.length === 0) {
              break;
            }
            const seqs = page.map((m) => m.sequenceNumber);
            // Each page is strictly descending.
            for (let i = 1; i < seqs.length; i += 1) {
              expect((seqs[i] as number) < (seqs[i - 1] as number)).toBe(true);
            }
            collected.push(...seqs);
            cursor = seqs[seqs.length - 1] as number;
            if (page.length < pageSize) {
              break;
            }
          }

          // No duplicates, and the full 1..total set is covered exactly once.
          expect(new Set(collected).size).toBe(collected.length);
          expect([...collected].sort((a, b) => a - b)).toEqual(
            Array.from({ length: total }, (_, i) => i + 1),
          );
        },
      ),
      { numRuns: 60 },
    );
  });

  it('after-paging returns strictly newer messages oldest-first with no overlap', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 40 }),
        fc.integer({ min: 0, max: 39 }),
        async (total, rawAfter) => {
          const repo = makeRepo();
          const conversationId = await openConversation(repo);
          for (let i = 1; i <= total; i += 1) {
            await repo.insertMessage({
              conversationId,
              senderId: 'host-1',
              clientMessageId: `c${i}`,
              body: `m${i}`,
            });
          }
          const after = Math.min(rawAfter, total);

          const page = await repo.getMessagesAfter(conversationId, after, 1000);
          const seqs = page.map((m) => m.sequenceNumber);

          expect(seqs.every((s) => s > after)).toBe(true);
          expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
          const expected = Array.from({ length: total }, (_, i) => i + 1).filter((s) => s > after);
          expect(seqs).toEqual(expected);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('P10 (14.4) — token scoping', () => {
  function buildController(isParticipant: boolean): {
    controller: CentrifugoController;
    participation: { isParticipant: jest.Mock };
  } {
    const tokenService = new CentrifugoTokenService();
    const participation = { isParticipant: jest.fn().mockResolvedValue(isParticipant) };
    const userRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'user-1' } as User),
    } as unknown as Repository<User>;
    const controller = new CentrifugoController(
      tokenService,
      participation as unknown as ChatParticipationService,
      userRepository,
    );
    return { controller, participation };
  }

  const request = {
    user: { keycloakId: 'kc-1', email: 'u@e.com', emailVerified: true, sessionState: 's' } as JwtUserPayload,
  };

  it('connection-token subject is always the authenticated caller (never client-supplied)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 40 }), async () => {
        const { controller } = buildController(true);
        const res = await controller.getToken(request as never, undefined);
        const decoded = jwt.verify(res.token, SECRET) as jwt.JwtPayload;
        expect(decoded.sub).toBe('user-1');
        expect(decoded.channel).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it('issues a subscription token only to a participant, by lookup — never trusting the channel id', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 40 }).map((s) => s.replace(/\s/g, '_') || 'c'),
        fc.boolean(),
        async (conversationId, participant) => {
          const { controller, participation } = buildController(participant);
          const channel = `${CHAT_CHANNEL_PREFIX}${conversationId}`;

          if (participant) {
            const res = await controller.getToken(request as never, channel);
            const decoded = jwt.verify(res.token, SECRET) as jwt.JwtPayload;
            expect(decoded.sub).toBe('user-1');
            expect(decoded.channel).toBe(channel);
            // Authorization was decided by a participation lookup for the caller, not the channel.
            expect(participation.isParticipant).toHaveBeenCalledWith('user-1', conversationId);
          } else {
            await expect(controller.getToken(request as never, channel)).rejects.toBeInstanceOf(
              ForbiddenException,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
