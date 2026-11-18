import { Injectable } from '@nestjs/common';

import { ServiceSessionRepository } from './service-session.repository';

/**
 * ServiceSessionParticipationService — the single source of the participation rule (Spec 17).
 *
 * A thin lookup resolving a session's `host_id`/`cleaner_id` and answering whether a given user is
 * one of them. Used by BOTH service-tracking's own authorization and the auth module's Centrifugo
 * subscription-token endpoint (auth owns tokens, service-tracking owns the participation rule) —
 * mirroring how `ChatParticipationService` backs the chat channel token. A session id or channel
 * name never authorizes by itself; identity is always the resolved user id.
 */
@Injectable()
export class ServiceSessionParticipationService {
  constructor(private readonly repository: ServiceSessionRepository) {}

  /** Whether `userId` is the host or cleaner of `sessionId`. False when the session is unknown. */
  async isParticipant(userId: string, sessionId: string): Promise<boolean> {
    const session = await this.repository.findById(sessionId);
    if (!session) {
      return false;
    }
    return session.host_id === userId || session.cleaner_id === userId;
  }
}
