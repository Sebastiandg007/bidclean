import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import {
  COMPLETION_ERROR_MESSAGES,
  CompletionReleaseReason,
  CompletionState,
  IntentStatus,
  RatingRole,
  ReleaseStatus,
  ServiceCompletionView,
} from '../completion.types';
import { CompletionParticipationService } from './completion-participation.service';
import { CompletionRepository, CompletionRow } from '../repository/completion.repository';
import { ReleaseIntentRepository } from '../repository/release-intent.repository';

/**
 * CompletionViewService — the participant-gated `GET` reconciliation read (Spec 20).
 *
 * Returns the authoritative state + snapshotted deadline + rating status + the server-DERIVED
 * `release_status` (`NOT_TRIGGERED`/`PENDING`/`ACCEPTED`), never the internal intent fields
 * (attempt/dispatched_at/lease_until/last_error). A non-participant receives 403 and learns nothing.
 */
@Injectable()
export class CompletionViewService {
  constructor(
    private readonly repository: CompletionRepository,
    private readonly intents: ReleaseIntentRepository,
    private readonly participation: CompletionParticipationService,
  ) {}

  /** Build the authoritative completion view for a participant. */
  async getCompletion(id: string, userId: string): Promise<ServiceCompletionView> {
    const completion = await this.repository.findById(id);
    if (!completion) {
      throw new NotFoundException(COMPLETION_ERROR_MESSAGES.COMPLETION_NOT_FOUND);
    }
    if (!this.participation.isParticipant(userId, completion)) {
      throw new ForbiddenException(COMPLETION_ERROR_MESSAGES.NOT_A_PARTICIPANT);
    }
    const releaseStatus = await this.deriveReleaseStatus(id);
    const ratedRoles = await this.repository.findRatedRoles(id);
    return this.toView(completion, releaseStatus, ratedRoles);
  }

  /** Derive the release-execution status from the completion's intent (no internal fields exposed). */
  private async deriveReleaseStatus(completionId: string): Promise<ReleaseStatus> {
    const intent = await this.intents.findByCompletion(completionId);
    if (!intent) {
      return ReleaseStatus.NOT_TRIGGERED;
    }
    return intent.status === IntentStatus.ACCEPTED ? ReleaseStatus.ACCEPTED : ReleaseStatus.PENDING;
  }

  /** Project a completion row to the client view. */
  private toView(
    completion: CompletionRow,
    releaseStatus: ReleaseStatus,
    ratedRoles: readonly string[],
  ): ServiceCompletionView {
    return {
      id: completion.id,
      serviceSessionId: completion.service_session_id,
      offerId: completion.offer_id,
      state: completion.state as CompletionState,
      autoReleaseDeadline: completion.auto_release_deadline.toISOString(),
      confirmedAt: completion.confirmed_at ? completion.confirmed_at.toISOString() : null,
      releasedTrigger: completion.released_trigger as CompletionReleaseReason | null,
      disputeId: completion.dispute_id,
      postReleaseDisputeId: completion.post_release_dispute_id,
      releaseStatus,
      ratingStatus: {
        hostRated: ratedRoles.includes(RatingRole.HOST_RATES_CLEANER),
        cleanerRated: ratedRoles.includes(RatingRole.CLEANER_RATES_HOST),
      },
    };
  }
}
