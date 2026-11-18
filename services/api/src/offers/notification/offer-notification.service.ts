import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { writeOutbox } from '../../common/outbox/outbox-writer';
import { buildOfferOutboxRow, OfferOutboxEventType } from './offer-outbox';

/**
 * Offer notification service.
 *
 * Push Task 12 (behavior-preserving migration, REQ-NP13): the new-offer push to an offline Cleaner
 * is no longer sent by calling OneSignal directly. Instead this service writes a durable
 * `offer_outbox` `offer.matched` row; the notifications relay drains it and the delivery worker
 * sends the push per consented device (Model B) using the `offer.*` mapper, which reproduces the
 * same recipient/content/best-effort semantics as the legacy direct send.
 *
 * Behavior:
 * - Writes ONE `offer_outbox` row per (offer, Cleaner), keyed by a deterministic `event_id` so a
 *   retry never duplicates the intent (exactly-once at the ledger).
 * - Returns true when the outbox row is durably persisted (the WebSocket-fallback caller treats
 *   this as a successful PUSH hand-off), false otherwise.
 * - Never throws — errors are caught internally and logged (no offerId/cleanerId PII beyond ids).
 */
@Injectable()
export class OfferNotificationService {
  private readonly logger = new Logger(OfferNotificationService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Enqueue a push notification to a Cleaner about a new offer by writing an `offer_outbox` row.
   *
   * @param cleanerId - UUID of the target Cleaner (the intent recipient)
   * @param offerId - UUID of the offer being delivered
   * @returns true if the outbox row was durably persisted, false otherwise
   */
  async sendOfferNotification(
    cleanerId: string,
    offerId: string,
  ): Promise<boolean> {
    try {
      // The outbox write runs in its own transaction so the durable row is committed atomically;
      // a rollback would leave no row (the relay drains nothing = safe no-op).
      await this.dataSource.transaction(async (manager) => {
        await writeOutbox(
          manager,
          buildOfferOutboxRow({
            offerId,
            recipientUserId: cleanerId,
            type: OfferOutboxEventType.MATCHED,
          }),
        );
      });

      this.logger.debug(
        `Offer push queued via offer_outbox for offer=${offerId} to cleaner=${cleanerId}`,
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `Failed to queue offer push for offer=${offerId} to cleaner=${cleanerId}: ${String(error)}`,
      );
      return false;
    }
  }
}
