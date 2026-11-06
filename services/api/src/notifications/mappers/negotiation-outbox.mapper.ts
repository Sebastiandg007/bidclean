import { Injectable } from '@nestjs/common';
import { NotificationIntent, NotificationType } from '../notifications.types';
import { NotificationTypeRegistry } from '../notification-type.registry';
import { OutboxEntityBase } from '../entities/outbox.entity';
import { OutboxMapper, deriveDedupKey, readId } from './outbox-mapper.types';

/**
 * Maps `negotiation_outbox` rows to intents. Deep-link is `{ type, threadId }` (ids only).
 * Recipient comes from the payload (`recipientUserId`).
 */
@Injectable()
export class NegotiationOutboxMapper implements OutboxMapper {
  readonly handledTypes = new Set<string>([
    NotificationType.NEGOTIATION_PROPOSAL_CREATED,
    NotificationType.NEGOTIATION_PROPOSAL_COUNTERED,
    NotificationType.NEGOTIATION_PROPOSAL_REJECTED,
    NotificationType.NEGOTIATION_PROPOSAL_ACCEPTED,
  ]);

  private static readonly DEEP_LINK_TYPE: Record<string, string> = {
    [NotificationType.NEGOTIATION_PROPOSAL_CREATED]: 'negotiation_created',
    [NotificationType.NEGOTIATION_PROPOSAL_COUNTERED]: 'negotiation_countered',
    [NotificationType.NEGOTIATION_PROPOSAL_REJECTED]: 'negotiation_rejected',
    [NotificationType.NEGOTIATION_PROPOSAL_ACCEPTED]: 'negotiation_accepted',
  };

  constructor(private readonly registry: NotificationTypeRegistry) {}

  map(row: OutboxEntityBase): NotificationIntent | null {
    if (!this.handledTypes.has(row.type)) {
      return null;
    }
    const recipientUserId = readId(row.payload, 'recipientUserId');
    const threadId = readId(row.payload, 'threadId') ?? row.aggregateId;
    if (!recipientUserId || !threadId) {
      return null;
    }
    const type = row.type as NotificationType;
    const deepLinkType = NegotiationOutboxMapper.DEEP_LINK_TYPE[row.type];
    if (deepLinkType === undefined) {
      return null;
    }
    const meta = this.registry.get(type);
    return {
      recipientUserId,
      type,
      category: meta.category,
      dedupKey: deriveDedupKey(row.eventId, row.version, recipientUserId),
      deepLink: { type: deepLinkType, threadId },
      priority: meta.priority,
      payloadRef: { threadId },
    };
  }
}
