import * as fc from 'fast-check';

import { OutboxRow, writeOutbox } from '../outbox-writer';
import {
  buildOfferOutboxRow,
  OFFER_OUTBOX_TABLE,
  OfferOutboxEventType,
} from '../../../offers/notification/offer-outbox';
import {
  buildPaymentOutboxRow,
  PAYMENT_OUTBOX_TABLE,
  PaymentOutboxEventType,
} from '../../../payments/payment-outbox';
import {
  buildNegotiationOutboxRow,
  NEGOTIATION_OUTBOX_TABLE,
  NegotiationOutboxEventType,
} from '../../../negotiation/negotiation-outbox';
import {
  buildMessageCreatedOutboxRow,
  CHAT_OUTBOX_TABLE,
  CHAT_EVENT_TYPE_MESSAGE_CREATED,
} from '../../../chat/chat-outbox';
import {
  buildCallInvitedOutboxRow,
  VOIP_OUTBOX_TABLE,
  VOIP_EVENT_TYPE_CALL_INVITED,
} from '../../../chat/voip/voip-outbox';

/**
 * Property-based tests (fast-check, >=100 iters) for the emitting-domain outbox writes (Task 12).
 *
 * Feature: push-notifications, Property 2: Emitting-domain outbox writes are atomic + deterministic
 * Feature: push-notifications, Property 3: Exactly-once intent under redelivery (event_id stability)
 * Validates: Requirements 2.1, 2.2, 2.6, 7.5
 *
 * These cover the pure, domain-owned shaping (deterministic event_id, ids-only payload) and the
 * transactional-atomicity contract of the shared writer: the outbox row is written via ONE
 * parameterized INSERT on the caller's executor, and a rollback of that executor's transaction
 * discards the row (so a business-fact rollback reverts the outbox row).
 */

const id = (): fc.Arbitrary<string> =>
  fc.uuid({ version: 4 }).filter((s) => s.length > 0);

/** A fake transactional executor that records INSERTs and can commit or roll them back. */
class RecordingTx {
  readonly committed: OutboxRow[] = [];
  private readonly staged: OutboxRow[] = [];

  async query(sql: string, params: readonly unknown[] = []): Promise<unknown> {
    if (!/^\s*INSERT INTO\s+"[A-Za-z_][A-Za-z0-9_]*"/.test(sql)) {
      throw new Error(`Unexpected SQL: ${sql}`);
    }
    const table = /INSERT INTO\s+"([A-Za-z_][A-Za-z0-9_]*)"/.exec(sql)?.[1] ?? '';
    this.staged.push({
      eventId: params[0] as string,
      aggregateType: params[1] as string,
      aggregateId: params[2] as string,
      type: params[3] as string,
      payload: JSON.parse(params[4] as string) as Record<string, unknown>,
      version: params[5] as number,
      tableName: table,
    });
    return undefined;
  }

  commit(): void {
    this.committed.push(...this.staged.splice(0));
  }

  rollback(): void {
    this.staged.splice(0);
  }
}

/** All five domain builders keyed by the table they target, with an arbitrary that produces a row. */
const builders: ReadonlyArray<{
  readonly table: string;
  readonly type: string;
  readonly rowArb: () => fc.Arbitrary<{ row: OutboxRow; recipientUserId: string }>;
}> = [
  {
    table: OFFER_OUTBOX_TABLE,
    type: OfferOutboxEventType.MATCHED,
    rowArb: () =>
      fc.record({ offerId: id(), recipientUserId: id() }).map((p) => ({
        row: buildOfferOutboxRow({ ...p, type: OfferOutboxEventType.MATCHED }),
        recipientUserId: p.recipientUserId,
      })),
  },
  {
    table: PAYMENT_OUTBOX_TABLE,
    type: PaymentOutboxEventType.CAPTURED,
    rowArb: () =>
      fc.record({ paymentId: id(), recipientUserId: id() }).map((p) => ({
        row: buildPaymentOutboxRow({ ...p, type: PaymentOutboxEventType.CAPTURED }),
        recipientUserId: p.recipientUserId,
      })),
  },
  {
    table: NEGOTIATION_OUTBOX_TABLE,
    type: NegotiationOutboxEventType.CREATED,
    rowArb: () =>
      fc.record({ proposalId: id(), threadId: id(), recipientUserId: id() }).map((p) => ({
        row: buildNegotiationOutboxRow({ ...p, type: NegotiationOutboxEventType.CREATED }),
        recipientUserId: p.recipientUserId,
      })),
  },
  {
    table: CHAT_OUTBOX_TABLE,
    type: CHAT_EVENT_TYPE_MESSAGE_CREATED,
    rowArb: () =>
      fc.record({ messageId: id(), conversationId: id(), recipientUserId: id() }).map((p) => ({
        row: buildMessageCreatedOutboxRow(p),
        recipientUserId: p.recipientUserId,
      })),
  },
  {
    table: VOIP_OUTBOX_TABLE,
    type: VOIP_EVENT_TYPE_CALL_INVITED,
    rowArb: () =>
      fc.record({ callId: id(), conversationId: id(), recipientUserId: id() }).map((p) => ({
        row: buildCallInvitedOutboxRow(p),
        recipientUserId: p.recipientUserId,
      })),
  },
];

describe('Emitting-domain outbox writes', () => {
  it('Property 3: event_id is deterministic — same fact yields the same id twice', () => {
    // Feature: push-notifications, Property 3: Exactly-once intent under redelivery
    fc.assert(
      fc.property(
        fc.record({ offerId: id(), recipientUserId: id() }),
        ({ offerId, recipientUserId }) => {
          const a = buildOfferOutboxRow({ offerId, recipientUserId, type: OfferOutboxEventType.MATCHED });
          const b = buildOfferOutboxRow({ offerId, recipientUserId, type: OfferOutboxEventType.MATCHED });
          expect(a.eventId).toBe(b.eventId);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('Property 3: distinct facts (offer or recipient) yield distinct event_ids', () => {
    // Feature: push-notifications, Property 3: Exactly-once intent under redelivery
    fc.assert(
      fc.property(id(), id(), id(), id(), (offerA, offerB, recA, recB) => {
        fc.pre(offerA !== offerB || recA !== recB);
        const a = buildOfferOutboxRow({ offerId: offerA, recipientUserId: recA, type: OfferOutboxEventType.MATCHED });
        const b = buildOfferOutboxRow({ offerId: offerB, recipientUserId: recB, type: OfferOutboxEventType.MATCHED });
        expect(a.eventId).not.toBe(b.eventId);
      }),
      { numRuns: 200 },
    );
  });

  it('Property 2: every builder writes exactly one row into its own table, ids-only payload', async () => {
    // Feature: push-notifications, Property 2: Emitting-domain outbox writes are atomic
    for (const b of builders) {
      await fc.assert(
        fc.asyncProperty(b.rowArb(), async ({ row, recipientUserId }) => {
          const tx = new RecordingTx();
          await writeOutbox(tx, row);
          tx.commit();
          expect(tx.committed).toHaveLength(1);
          const written = tx.committed[0]!;
          expect(written.tableName).toBe(b.table);
          expect(written.type).toBe(b.type);
          // Payload carries the recipient + ids only (no bodies/amounts/PII beyond ids).
          expect(written.payload.recipientUserId).toBe(recipientUserId);
          for (const value of Object.values(written.payload)) {
            expect(typeof value).toBe('string');
          }
        }),
        { numRuns: 100 },
      );
    }
  });

  it('Property 2: a rolled-back transaction discards the outbox row (atomic with the fact)', async () => {
    // Feature: push-notifications, Property 2: Emitting-domain outbox writes are atomic
    for (const b of builders) {
      await fc.assert(
        fc.asyncProperty(b.rowArb(), fc.boolean(), async ({ row }, commit) => {
          const tx = new RecordingTx();
          await writeOutbox(tx, row);
          if (commit) {
            tx.commit();
            expect(tx.committed).toHaveLength(1);
          } else {
            tx.rollback();
            expect(tx.committed).toHaveLength(0);
          }
        }),
        { numRuns: 100 },
      );
    }
  });
});