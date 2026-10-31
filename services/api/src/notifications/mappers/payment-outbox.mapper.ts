import { Injectable } from '@nestjs/common';
import { NotificationIntent, NotificationType } from '../notifications.types';
import { NotificationTypeRegistry } from '../notification-type.registry';
import { OutboxEntityBase } from '../entities/outbox.entity';
import { OutboxMapper, deriveDedupKey, readId } from './outbox-mapper.types';

/**
 * Maps `payment_outbox` rows to intents. Deep-link is `{ type, paymentId }` (ids only, no amounts
 * or instruments). Recipient comes from the payload (`recipientUserId`).
 */
@Injectable()
export class PaymentOutboxMapper implements OutboxMapper {
  readonly handledTypes = new Set<string>([
    NotificationType.PAYMENT_CAPTURED,
    NotificationType.PAYMENT_RELEASED,
    NotificationType.PAYMENT_FAILED,
    NotificationType.PAYMENT_REFUNDED,
    NotificationType.PAYMENT_DISPUTED,
  ]);

  private static readonly DEEP_LINK_TYPE: Record<string, string> = {
    [NotificationType.PAYMENT_CAPTURED]: 'payment_captured',
    [NotificationType.PAYMENT_RELEASED]: 'payment_released',
    [NotificationType.PAYMENT_FAILED]: 'payment_failed',
    [NotificationType.PAYMENT_REFUNDED]: 'payment_refunded',
    [NotificationType.PAYMENT_DISPUTED]: 'payment_disputed',
  };

  constructor(private readonly registry: NotificationTypeRegistry) {}

  map(row: OutboxEntityBase): NotificationIntent | null {
    if (!this.handledTypes.has(row.type)) {
      return null;
    }
    const recipientUserId = readId(row.payload, 'recipientUserId');
    const paymentId = readId(row.payload, 'paymentId') ?? row.aggregateId;
    if (!recipientUserId || !paymentId) {
      return null;
    }
    const type = row.type as NotificationType;
    const deepLinkType = PaymentOutboxMapper.DEEP_LINK_TYPE[row.type];
    if (deepLinkType === undefined) {
      return null;
    }
    const meta = this.registry.get(type);
    return {
      recipientUserId,
      type,
      category: meta.category,
      dedupKey: deriveDedupKey(row.eventId, row.version, recipientUserId),
      deepLink: { type: deepLinkType, paymentId },
      priority: meta.priority,
      payloadRef: { paymentId },
    };
  }
}
