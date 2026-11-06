import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';

import {
  buildConfirmedOutboxRow,
  buildDisputedOutboxRow,
} from '../completion-outbox';
import {
  COMPLETION_ERROR_MESSAGES,
  CompletionReleaseReason,
  CompletionState,
} from '../completion.types';
import { CompletionParticipationService } from './completion-participation.service';
import { CompletionRepository, CompletionRow } from '../repository/completion.repository';

/**
 * CompletionDecisionService — the single-winner pre-release + post-release Host decisions (Spec 20).
 *
 * `confirm`/`openDispute`/`openPostReleaseDispute` are Host-only. Each pre-release decision is a
 * single-winner conditional transition (`WHERE state='AWAITING_CONFIRMATION'`); a release-bearing
 * winner co-persists exactly one `release_intent` + `service_confirmed`, a dispute co-writes
 * `service_disputed` with NO intent (auto-release suppressed). NONE of these call Stripe — the
 * release is driven out-of-band by the worker. `openPostReleaseDispute` gates on the release being
 * ACCEPTED (money actually moved), else 409 (release not yet executed). Functions ≤30 lines.
 */
@Injectable()
export class CompletionDecisionService {
  constructor(
    private readonly repository: CompletionRepository,
    private readonly participation: CompletionParticipationService,
  ) {}

  /** Host confirms satisfaction → single-winner CONFIRMED + release_intent(HOST_CONFIRMED). */
  async confirm(id: string, userId: string): Promise<void> {
    const completion = await this.requireHost(id, userId);
    if (completion.state === CompletionState.CONFIRMED) {
      return; // idempotent no-op (already confirmed) — never a second intent
    }
    const won = await this.repository.transition(
      id,
      CompletionState.CONFIRMED,
      { confirmedAt: true, releasedTrigger: CompletionReleaseReason.HOST_CONFIRMED },
      { paymentId: completion.payment_id, reason: CompletionReleaseReason.HOST_CONFIRMED },
      buildConfirmedOutboxRow(id, completion.offer_id, CompletionReleaseReason.HOST_CONFIRMED),
    );
    if (!won) {
      throw new ConflictException(COMPLETION_ERROR_MESSAGES.INVALID_STATE);
    }
  }

  /** Host opens a pre-release dispute → single-winner DISPUTED, no intent (auto-release suppressed). */
  async openDispute(id: string, userId: string): Promise<void> {
    const completion = await this.requireHost(id, userId);
    if (completion.state === CompletionState.DISPUTED) {
      return; // idempotent no-op (already disputed)
    }
    const disputeId = completion.dispute_id ?? randomUUID();
    const won = await this.repository.transition(
      id,
      CompletionState.DISPUTED,
      { disputeId },
      null,
      buildDisputedOutboxRow(id, completion.offer_id, disputeId),
    );
    if (!won) {
      throw new ConflictException(COMPLETION_ERROR_MESSAGES.INVALID_STATE);
    }
  }

  /**
   * Host opens a post-release dispute → sets `post_release_dispute_id`, state preserved, no reversal.
   * Allowed ONLY when the release is actually ACCEPTED (money moved); a released decision whose
   * intent is still PENDING/DISPATCHED is a PRE-release concern → 409 (release not yet executed).
   */
  async openPostReleaseDispute(id: string, userId: string): Promise<void> {
    const completion = await this.requireHost(id, userId);
    if (completion.post_release_dispute_id !== null) {
      return; // idempotent no-op (already post-disputed)
    }
    const disputeId = randomUUID();
    const won = await this.repository.transitionPostReleaseDispute(
      id,
      disputeId,
      buildDisputedOutboxRow(id, completion.offer_id, disputeId),
    );
    if (!won) {
      throw new ConflictException(this.postReleaseConflictMessage(completion));
    }
  }

  /** Load the completion + assert the caller is its Host (else 404/403). */
  private async requireHost(id: string, userId: string): Promise<CompletionRow> {
    const completion = await this.repository.findById(id);
    if (!completion) {
      throw new NotFoundException(COMPLETION_ERROR_MESSAGES.COMPLETION_NOT_FOUND);
    }
    if (!this.participation.isParticipant(userId, completion)) {
      throw new ForbiddenException(COMPLETION_ERROR_MESSAGES.NOT_A_PARTICIPANT);
    }
    if (!this.participation.isHost(userId, completion)) {
      throw new ForbiddenException(COMPLETION_ERROR_MESSAGES.NOT_THE_HOST);
    }
    return completion;
  }

  /** Distinguish "released but not yet ACCEPTED" (retry) from "not in a released state". */
  private postReleaseConflictMessage(completion: CompletionRow): string {
    const inReleasedState =
      completion.state === CompletionState.CONFIRMED ||
      completion.state === CompletionState.AUTO_RELEASED;
    return inReleasedState
      ? COMPLETION_ERROR_MESSAGES.RELEASE_NOT_YET_EXECUTED
      : COMPLETION_ERROR_MESSAGES.INVALID_STATE;
  }
}
