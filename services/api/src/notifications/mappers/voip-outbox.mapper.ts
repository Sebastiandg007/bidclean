import { Injectable } from '@nestjs/common';
import { NotificationIntent, NotificationType } from '../notifications.types';
import { NotificationTypeRegistry } from '../notification-type.registry';
import { OutboxEntityBase } from '../entities/outbox.entity';
import { OutboxMapper, deriveDedupKey, readId } from './outbox-mapper.types';

/**
 * Maps `voip_outbox` `call-invited` rows to intents (the Spec 15 incoming-call handoff). Deep-link
 * is `{ type: 'incoming_call', callId, conversationId }` so the app opens the incoming-call UI and
 * GET-reconciles. The type's metadata is HIGH + EXEMPT (bypasses quiet hours / non-urgent opt-out).
 */
@Injectable()
export class VoipOutboxMapper implements OutboxMapper {
  readonly handledTypes = new Set<string>([NotificationType.CALL_INVITED]);

  constructor(private readonly registry: NotificationTypeRegistry) {}

  map(row: OutboxEntityBase): NotificationIntent | null {
    if (!this.handledTypes.has(row.type)) {
      return null;
    }
    const recipientUserId = readId(row.payload, 'recipientUserId');
    const callId = readId(row.payload, 'callId') ?? row.aggregateId;
    const conversationId = readId(row.payload, 'conversationId');
    if (!recipientUserId || !callId || !conversationId) {
      return null;
    }
    const type = row.type as NotificationType;
    const meta = this.registry.get(type);
    return {
      recipientUserId,
      type,
      category: meta.category,
      dedupKey: deriveDedupKey(row.eventId, row.version, recipientUserId),
      deepLink: { type: 'incoming_call', callId, conversationId },
      priority: meta.priority,
      payloadRef: { callId, conversationId },
    };
  }
}
