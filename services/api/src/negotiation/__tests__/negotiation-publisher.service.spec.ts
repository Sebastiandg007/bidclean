import { NegotiationPublisher } from '../events/negotiation-publisher.service';
import { NEGOTIATION_EVENT_NAMES } from '../events/negotiation-events';

/**
 * Unit tests for NegotiationPublisher channel scoping and privacy boundary.
 *
 * Feature: offer-negotiation
 * Validates Requirement 7.7/7.8 (channel scoping; no winner-identity leak to losers)
 * and the best-effort publish contract (failures swallowed).
 */
describe('NegotiationPublisher', () => {
  let centrifugo: { publish: jest.Mock; broadcast: jest.Mock };
  let publisher: NegotiationPublisher;

  const params = {
    threadId: 'thread-1',
    proposalId: 'proposal-1',
    offerId: 'offer-1',
    version: 3,
    sequenceNumber: 2,
  };

  beforeEach(() => {
    centrifugo = {
      publish: jest.fn().mockResolvedValue(true),
      broadcast: jest.fn().mockResolvedValue(true),
    };
    publisher = new NegotiationPublisher(centrifugo as never);
  });

  it('publishes proposal_created only to the Host channel', async () => {
    await publisher.publishProposalCreatedToHost('host-9', params);

    expect(centrifugo.publish).toHaveBeenCalledTimes(1);
    const [channel, event] = centrifugo.publish.mock.calls[0];
    expect(channel).toBe('negotiation:host:host-9');
    expect(event.type).toBe(NEGOTIATION_EVENT_NAMES.PROPOSAL_CREATED);
    expect(event.eventId).toEqual(expect.any(String));
    expect(event.version).toBe(3);
    expect(event.sequenceNumber).toBe(2);
  });

  it('publishes proposal_countered only to the Cleaner channel', async () => {
    await publisher.publishProposalCounteredToCleaner('cleaner-7', params);

    const [channel] = centrifugo.publish.mock.calls[0];
    expect(channel).toBe('negotiation:cleaner:cleaner-7');
  });

  it('broadcasts offer_status_changed{MATCHED} to OTHER cleaners radar channels only', async () => {
    await publisher.publishOfferMatchedToOtherCleaners(['cleaner-a', 'cleaner-b'], 'offer-1');

    expect(centrifugo.broadcast).toHaveBeenCalledTimes(1);
    const [channels, event] = centrifugo.broadcast.mock.calls[0];
    expect(channels).toEqual(['offers:cleaner:cleaner-a', 'offers:cleaner:cleaner-b']);
    expect(event).toEqual(
      expect.objectContaining({ type: 'offer_status_changed', state: 'MATCHED', offerId: 'offer-1' }),
    );
    // Privacy: the match broadcast carries no negotiation detail or winner identity.
    expect(event).not.toHaveProperty('cleanerId');
    expect(event).not.toHaveProperty('proposalId');
  });

  it('does not broadcast when there are no other cleaners', async () => {
    await publisher.publishOfferMatchedToOtherCleaners([], 'offer-1');
    expect(centrifugo.broadcast).not.toHaveBeenCalled();
  });

  it('swallows publish failures (best-effort — never throws)', async () => {
    centrifugo.publish.mockRejectedValue(new Error('centrifugo down'));
    await expect(publisher.publishProposalCreatedToHost('host-9', params)).resolves.toBeUndefined();
  });

  it('swallows broadcast failures (best-effort — never throws)', async () => {
    centrifugo.broadcast.mockRejectedValue(new Error('centrifugo down'));
    await expect(
      publisher.publishOfferMatchedToOtherCleaners(['cleaner-a'], 'offer-1'),
    ).resolves.toBeUndefined();
  });
});
