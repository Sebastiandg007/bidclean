import { Injectable, Logger } from '@nestjs/common';

import { SERVICE_AUTO_RELEASE_WINDOW_MS } from '../completion.constants';
import { COMPLETION_ERROR_MESSAGES, ChecklistCompletedPayload } from '../completion.types';
import { CompletionRepository } from '../repository/completion.repository';

/**
 * CompletionCreationService — idempotent creation off the durable `checklist_completed` fact.
 *
 * Rejects a payload without the authoritative finish time (`completedAt`) so the deadline is never
 * anchored to a consume time. Resolves the participants + escrow `payment_id` server-side from the
 * offer bound to the session, snapshots `auto_release_deadline = completedAt + window`, and inserts
 * `ON CONFLICT (service_session_id) DO NOTHING`. Never re-reads Spec 19's run. Functions ≤30 lines.
 */
@Injectable()
export class CompletionCreationService {
  private readonly logger = new Logger(CompletionCreationService.name);

  constructor(private readonly repository: CompletionRepository) {}

  /** Create the completion for a `checklist_completed` event (idempotent). */
  async createFromChecklistCompleted(payload: ChecklistCompletedPayload): Promise<void> {
    const completedAt = this.parseCompletedAt(payload);
    const offerId = await this.repository.resolveOfferIdForSession(payload.serviceSessionId);
    if (!offerId) {
      throw new Error(COMPLETION_ERROR_MESSAGES.PAYMENT_NOT_RESOLVED);
    }
    const resolved = await this.repository.resolvePaymentForOffer(offerId);
    if (!resolved) {
      throw new Error(COMPLETION_ERROR_MESSAGES.PAYMENT_NOT_RESOLVED);
    }
    const created = await this.repository.createCompletion({
      serviceSessionId: payload.serviceSessionId,
      offerId,
      paymentId: resolved.paymentId,
      hostId: resolved.hostId,
      cleanerId: resolved.cleanerId,
      checklistCompletedAt: completedAt,
      autoReleaseDeadline: new Date(completedAt.getTime() + SERVICE_AUTO_RELEASE_WINDOW_MS),
    });
    if (created) {
      this.logger.log(`Completion created for session ${payload.serviceSessionId}`);
    }
  }

  /** Parse + validate the authoritative finish time (defensive guard against pre-extension events). */
  private parseCompletedAt(payload: ChecklistCompletedPayload): Date {
    const raw = payload.completedAt;
    if (typeof raw !== 'string' || raw.length === 0 || Number.isNaN(Date.parse(raw))) {
      throw new Error(COMPLETION_ERROR_MESSAGES.MISSING_COMPLETED_AT);
    }
    return new Date(raw);
  }
}
