import { Injectable } from '@nestjs/common';

import { CompletionRow } from '../repository/completion.repository';

/**
 * CompletionParticipationService — the single source of the authorization rule for every endpoint.
 *
 * Resolves `host_id`/`cleaner_id` from the completion row (denormalized from the offer at creation).
 * A nulled participant after user deletion resolves to a non-participant for that id while the row
 * is retained as audit history. Pure — no I/O; the completion is loaded by the caller.
 */
@Injectable()
export class CompletionParticipationService {
  /** Whether `userId` is the completion's Host. */
  isHost(userId: string, completion: CompletionRow): boolean {
    return completion.host_id !== null && completion.host_id === userId;
  }

  /** Whether `userId` is the completion's Cleaner. */
  isCleaner(userId: string, completion: CompletionRow): boolean {
    return completion.cleaner_id !== null && completion.cleaner_id === userId;
  }

  /** Whether `userId` is either participant of the completion. */
  isParticipant(userId: string, completion: CompletionRow): boolean {
    return this.isHost(userId, completion) || this.isCleaner(userId, completion);
  }
}
