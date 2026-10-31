import { Injectable } from '@nestjs/common';

import { ChecklistRepository } from '../repository/checklist.repository';

/**
 * ChecklistParticipationService — the single source of the participation rule (Spec 19).
 *
 * A thin lookup resolving a session's `host_id`/`cleaner_id` and answering whether a given user is
 * a participant (host or cleaner) or specifically the Cleaner. Every checklist endpoint authorizes
 * through this — a session id or object key never authorizes by itself; identity is always the
 * resolved user id. A nulled participant (after user deletion) resolves to a non-participant for
 * that id while the run/tasks are retained as the completion record.
 */
@Injectable()
export class ChecklistParticipationService {
  constructor(private readonly repository: ChecklistRepository) {}

  /** Whether `userId` is the host or cleaner of `sessionId`. False when the session is unknown. */
  async isParticipant(userId: string, sessionId: string): Promise<boolean> {
    const parties = await this.repository.findSessionParticipants(sessionId);
    if (!parties) {
      return false;
    }
    return parties.hostId === userId || parties.cleanerId === userId;
  }

  /** Whether `userId` is the Cleaner of `sessionId`. False when the session is unknown. */
  async isCleaner(userId: string, sessionId: string): Promise<boolean> {
    const parties = await this.repository.findSessionParticipants(sessionId);
    if (!parties) {
      return false;
    }
    return parties.cleanerId === userId;
  }

  /** Whether the session is currently in the IN_PROGRESS window (checklist work allowed). */
  async isInProgress(sessionId: string): Promise<boolean> {
    const parties = await this.repository.findSessionParticipants(sessionId);
    return parties?.state === 'IN_PROGRESS';
  }
}
