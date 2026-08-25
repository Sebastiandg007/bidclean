import { Injectable, Logger } from '@nestjs/common';

/**
 * Offer notification service.
 *
 * Sends push notifications to offline Cleaners via OneSignal
 * as a fallback when WebSocket delivery fails.
 * Updates delivery records with channel = PUSH on success.
 */
@Injectable()
export class OfferNotificationService {
  private readonly logger = new Logger(OfferNotificationService.name);

  /**
   * Send a push notification to a Cleaner about a new offer.
   */
  async sendOfferNotification(
    cleanerId: string,
    offerId: string,
  ): Promise<boolean> {
    // TODO: Implement in Task 21
    return false;
  }
}
