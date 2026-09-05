import { ChatService } from '../chat.service';
import { OFFER_EVENT_NAMES } from '../../offers/events/offer-domain-events';
import { OfferTerminalChatListener } from '../listeners/offer-terminal-chat.listener';

/**
 * Unit tests for OfferTerminalChatListener.
 *
 * Validates: Requirements 1.5, 1.6, 2.5 / P8, P17. Cancellation/expiration/completion close the
 * offer's conversations idempotently; MATCHED never closes; a close failure is swallowed.
 */

function makeListener(): {
  listener: OfferTerminalChatListener;
  chatService: jest.Mocked<Pick<ChatService, 'closeConversationsForOffer'>>;
} {
  const chatService = {
    closeConversationsForOffer: jest.fn().mockResolvedValue(undefined),
  };
  const listener = new OfferTerminalChatListener(chatService as unknown as ChatService);
  return { listener, chatService };
}

const base = { offerId: 'offer-1', hostId: 'host-1', timestamp: new Date() };

describe('OfferTerminalChatListener', () => {
  it('closes conversations on offer cancelled (P17)', async () => {
    const { listener, chatService } = makeListener();
    await listener.handleOfferCancelled({
      ...base,
      type: OFFER_EVENT_NAMES.CANCELLED,
      previousState: 'ACTIVE',
    } as never);
    expect(chatService.closeConversationsForOffer).toHaveBeenCalledWith('offer-1');
  });

  it('closes conversations on offer expired (P17)', async () => {
    const { listener, chatService } = makeListener();
    await listener.handleOfferExpired({
      ...base,
      type: OFFER_EVENT_NAMES.EXPIRED,
      finalRadius: 25000,
    } as never);
    expect(chatService.closeConversationsForOffer).toHaveBeenCalledWith('offer-1');
  });

  it('closes conversations on offer completed', async () => {
    const { listener, chatService } = makeListener();
    await listener.handleOfferCompleted({
      ...base,
      type: OFFER_EVENT_NAMES.COMPLETED,
      cleanerId: 'cleaner-1',
    } as never);
    expect(chatService.closeConversationsForOffer).toHaveBeenCalledWith('offer-1');
  });

  it('does NOT close on offer matched (chat opens at match)', () => {
    const { listener, chatService } = makeListener();
    listener.handleOfferMatched({
      ...base,
      type: OFFER_EVENT_NAMES.MATCHED,
      cleanerId: 'cleaner-1',
      matchSource: 'negotiation',
    } as never);
    expect(chatService.closeConversationsForOffer).not.toHaveBeenCalled();
  });

  it('swallows a close failure (best-effort, never propagates)', async () => {
    const { listener, chatService } = makeListener();
    chatService.closeConversationsForOffer.mockRejectedValue(new Error('db down'));
    await expect(
      listener.handleOfferCancelled({
        ...base,
        type: OFFER_EVENT_NAMES.CANCELLED,
        previousState: 'ACTIVE',
      } as never),
    ).resolves.toBeUndefined();
  });
});
