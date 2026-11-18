import { NotificationType } from '../notifications.types';
import { OutboxRelayProcessor } from '../outbox-relay.processor';
import { NotificationsRepository, OutboxRowRecord } from '../notifications.repository';
import { NotificationService } from '../notification.service';
import { NotificationTypeRegistry } from '../notification-type.registry';
import { OfferOutboxMapper } from '../mappers/offer-outbox.mapper';
import { PaymentOutboxMapper } from '../mappers/payment-outbox.mapper';
import { NegotiationOutboxMapper } from '../mappers/negotiation-outbox.mapper';
import { ChatOutboxMapper } from '../mappers/chat-outbox.mapper';
import { VoipOutboxMapper } from '../mappers/voip-outbox.mapper';

/**
 * Unit tests for OutboxRelayProcessor (Task 7.2).
 * Feature: push-notifications — P1 (isolation), P2 (durable trigger).
 */
describe('OutboxRelayProcessor', () => {
  const registry = new NotificationTypeRegistry();

  function offerRow(eventId: string, offerId: string): OutboxRowRecord {
    return {
      id: `row-${eventId}`,
      eventId,
      aggregateType: 'offer',
      aggregateId: offerId,
      type: NotificationType.OFFER_MATCHED,
      payload: { recipientUserId: 'user-1', offerId },
      version: 1,
      createdAt: new Date(),
      relayedAt: null,
    };
  }

  function build(rowsByTable: Record<string, OutboxRowRecord[]>) {
    const repo = {
      findUnrelayed: jest.fn(async (table: string) => rowsByTable[table] ?? []),
      markRelayed: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<NotificationsRepository>;
    const notifications = {
      createIntent: jest.fn().mockResolvedValue('ledger-1'),
    } as unknown as jest.Mocked<NotificationService>;
    const relay = new OutboxRelayProcessor(
      repo,
      notifications,
      new OfferOutboxMapper(registry),
      new PaymentOutboxMapper(registry),
      new NegotiationOutboxMapper(registry),
      new ChatOutboxMapper(registry),
      new VoipOutboxMapper(registry),
    );
    return { relay, repo, notifications };
  }

  it('creates an intent and marks the row relayed for a mapped event', async () => {
    const { relay, repo, notifications } = build({ offer_outbox: [offerRow('evt-1', 'offer-1')] });

    await relay.drainAll();

    expect(notifications.createIntent).toHaveBeenCalledTimes(1);
    expect(repo.markRelayed).toHaveBeenCalledWith('offer_outbox', 'evt-1');
  });

  it('P1: a createIntent throw is row-scoped — the row is left unrelayed for the next drain', async () => {
    const { relay, repo, notifications } = build({ offer_outbox: [offerRow('evt-2', 'offer-2')] });
    (notifications.createIntent as jest.Mock).mockRejectedValueOnce(new Error('mapper boom'));

    await expect(relay.drainAll()).resolves.toBeUndefined();

    // Not marked relayed -> will be retried next interval.
    expect(repo.markRelayed).not.toHaveBeenCalledWith('offer_outbox', 'evt-2');
  });

  it('marks a non-notification-worthy (unmapped) row relayed without creating an intent', async () => {
    const unknownRow: OutboxRowRecord = { ...offerRow('evt-3', 'offer-3'), type: 'offer.unknown' };
    const { relay, repo, notifications } = build({ offer_outbox: [unknownRow] });

    await relay.drainAll();

    expect(notifications.createIntent).not.toHaveBeenCalled();
    expect(repo.markRelayed).toHaveBeenCalledWith('offer_outbox', 'evt-3');
  });

  it('scans all five outbox tables each drain', async () => {
    const { relay, repo } = build({});
    await relay.drainAll();
    const scanned = (repo.findUnrelayed as jest.Mock).mock.calls.map((c) => c[0]);
    expect(scanned).toEqual([
      'offer_outbox',
      'payment_outbox',
      'negotiation_outbox',
      'chat_outbox',
      'voip_outbox',
    ]);
  });
});
