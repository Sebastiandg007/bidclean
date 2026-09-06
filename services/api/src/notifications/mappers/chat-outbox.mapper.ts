import { Injectable } from '@nestjs/common';
import { NotificationIntent, NotificationType } from '../notifications.types';
import { NotificationTypeRegistry } from '../notification-type.registry';
import { OutboxEntityBase } from '../entities/outbox.entity';
import { OutboxMapper, deriveDedupKey, readId } from './outbox-mapper.types';

/**
 * Maps `chat_outbox` `message-created` rows to intents. Deep-link is
 * `{ type: 'new_message', conversationId }` (ids only — NEVER the message body). The trigger is the
 * durable outbox row, not the Centrifugo frame (REQ-NP2b).
 */
@Injectable()
export class ChatOutboxMapper implements OutboxMapper {
  readonly handledTypes = new Set<string>([NotificationType.MESSAGE_CREATED]);

  constructor(private readonly registry: NotificationTypeRegistry) {}

  map(row: OutboxEntityBase): NotificationIntent | null {
    if (!this.handledTypes.has(row.type)) {
      return null;
    }
    const recipientUserId = readId(row.payload, 'recipientUserId');
    const conversationId = readId(row.payload, 'conversationId') ?? row.aggregateId;
    if (!recipientUserId || !conversationId) {
      return null;
    }
    const type = row.type as NotificationType;
    const meta = this.registry.get(type);
    return {
      recipientUserId,
      type,
      category: meta.category,
      dedupKey: deriveDedupKey(row.eventId, row.version, recipientUserId),
      deepLink: { type: 'new_message', conversationId },
      priority: meta.priority,
      payloadRef: { conversationId },
    };
  }
}
