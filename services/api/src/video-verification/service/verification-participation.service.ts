import { Injectable } from '@nestjs/common';

import { VerificationRepository, VerificationRow } from '../repository/verification.repository';

/** The resolved participation facts for a verification (used to gate every endpoint). */
export interface Participation {
  readonly isParticipant: boolean;
  readonly isCleaner: boolean;
  readonly row: VerificationRow;
}

/**
 * VerificationParticipationService — the single source of the participation rule.
 *
 * Resolves a verification's `cleaner_id`/`host_id` server-side and decides whether a `userId` is a
 * participant (and specifically the Cleaner). A verification whose participant was nulled after user
 * deletion resolves to non-participant for that id — history is still retained. Used by every
 * endpoint so authorization never derives from client identity, an object key, or a session id.
 */
@Injectable()
export class VerificationParticipationService {
  constructor(private readonly repository: VerificationRepository) {}

  /** Resolve participation for a verification id, or null when the verification does not exist. */
  async resolve(userId: string, verificationId: string): Promise<Participation | null> {
    const row = await this.repository.findById(verificationId);
    if (!row) {
      return null;
    }
    const isCleaner = row.cleaner_id !== null && row.cleaner_id === userId;
    const isHost = row.host_id !== null && row.host_id === userId;
    return { isParticipant: isCleaner || isHost, isCleaner, row };
  }
}
