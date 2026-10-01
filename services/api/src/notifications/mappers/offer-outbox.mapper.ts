import { Injectable } from '@nestjs/common';
import { NotificationIntent, NotificationType } from '../notifications.types';
import { NotificationTypeRegistry } from '../notification-type.registry';
import { OutboxEntityBase } from '../entities/outbox.entity';
import { OutboxMapper, deriveDedupKey, readId } from './outbox-mapper.types';

/**
 * Maps `offer_outbox` rows to notification intents. Deep-link is `{ type, offerId }` (ids only).
 * The recipient is read from the payload (`recipientUserId`), shaped by the emitting domain.
 * This reproduces the legacy offer-radar new-offer push semantics (REQ-NP13).
 */
@Injectable()
export class OfferOutboxMapper implements OutboxMapper {
  readonly handledTypes = new Set<string>([
    NotificationType.OFFER_MATCHED,
    NotificationType.OFFER_CANCELLED,
    NotificationType.OFFER_EXPIRED,
    NotificationType.OFFER_COMPLETED,
  ]);

  private static readonly DEEP_LINK_TYPE: Record<string, string> = {
    [NotificationType.OFFER_MATCHED]: 'offer_matched',
    [NotificationType.OFFER_CANCELLED]: 'offer_cancelled',
    [NotificationType.OFFER_EXPIRED]: 'offer_expired',
    [NotificationType.OFFER_COMPLETED]: 'offer_completed',
  };

  constructor(private readonly registry: NotificationTypeRegistry) {}

  map(row: OutboxEntityBase): NotificationIntent | null {
    if (!this.handledTypes.has(row.type)) {
      return null;
    }
    const recipientUserId = readId(row.payload, 'recipientUserId');
    const offerId = readId(row.payload, 'offerId') ?? row.aggregateId;
    if (!recipientUserId || !offerId) {
      return null;
    }
    const type = row.type as NotificationType;
    const deepLinkType = OfferOutboxMapper.DEEP_LINK_TYPE[row.type];
    if (deepLinkType === undefined) {
      return null;
    }
    const meta = this.registry.get(type);
    return {
      recipientUserId,
      type,
      category: meta.category,
      dedupKey: deriveDedupKey(row.eventId, row.version, recipientUserId),
      deepLink: { type: deepLinkType, offerId },
      priority: meta.priority,
      payloadRef: { offerId },
    };
  }
}
