import { Injectable, Logger } from '@nestjs/common';

import { OneSignalClient, OneSignalNotificationPayload } from './onesignal.client';
import { NOTIFICATION_CONTENT } from './notification.constants';

/**
 * Offer notification service.
 *
 * Sends push notifications to offline Cleaners via OneSignal
 * as a fallback when WebSocket delivery fails.
 *
 * Behavior:
 * - Builds push payload with offer details for deep linking
 * - Delegates delivery to OneSignalClient
 * - Returns true/false based on OneSignal acceptance
 * - Never throws — errors are caught internally and logged
 */
@Injectable()
export class OfferNotificationService {
  private readonly logger = new Logger(OfferNotificationService.name);

  constructor(private readonly oneSignalClient: OneSignalClient) {}

  /**
   * Send a push notification to a Cleaner about a new offer.
   *
   * @param cleanerId - UUID of the target Cleaner (used as OneSignal external user ID)
   * @param offerId - UUID of the offer being delivered
   * @returns true if push was accepted by OneSignal, false otherwise
   */
  async sendOfferNotification(
    cleanerId: string,
    offerId: string,
  ): Promise<boolean> {
    try {
      const payload = this.buildNotificationPayload(offerId);
      const success = await this.oneSignalClient.sendToUser(cleanerId, payload);

      if (success) {
        this.logger.debug(
          `Push notification sent for offer=${offerId} to cleaner=${cleanerId}`,
        );
      } else {
        this.logger.debug(
          `Push notification not delivered for offer=${offerId} to cleaner=${cleanerId}`,
        );
      }

      return success;
    } catch (error) {
      this.logger.warn(
        `Unexpected error sending push for offer=${offerId} to cleaner=${cleanerId}: ${String(error)}`,
      );
      return false;
    }
  }

  /** Build the OneSignal notification payload for a new offer. */
  private buildNotificationPayload(offerId: string): OneSignalNotificationPayload {
    return {
      headings: {
        en: NOTIFICATION_CONTENT.NEW_OFFER_HEADING_EN,
        es: NOTIFICATION_CONTENT.NEW_OFFER_HEADING_ES,
      },
      contents: {
        en: NOTIFICATION_CONTENT.NEW_OFFER_BODY_EN,
        es: NOTIFICATION_CONTENT.NEW_OFFER_BODY_ES,
      },
      data: {
        type: NOTIFICATION_CONTENT.OFFER_DATA_TYPE,
        offerId,
      },
    };
  }
}
