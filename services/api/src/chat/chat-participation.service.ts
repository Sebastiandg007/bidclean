import { Injectable } from '@nestjs/common';

import { ChatRepository } from './chat.repository';

/**
 * ChatParticipationService — the single source of the chat participation rule.
 *
 * Answers one question: is a given user id a participant (`hostId` or `cleanerId`) of a
 * conversation? It is consumed both by chat's own authorization and by the auth module's
 * Centrifugo subscription-token endpoint (auth owns token issuance, chat owns participation).
 * Identity is always the authenticated subject supplied by the caller — never derived from a
 * client-supplied value or a channel string.
 */
@Injectable()
export class ChatParticipationService {
  constructor(private readonly chatRepository: ChatRepository) {}

  /** Whether `userId` participates in `conversationId`. */
  isParticipant(userId: string, conversationId: string): Promise<boolean> {
    return this.chatRepository.isParticipant(userId, conversationId);
  }
}
