import { Injectable } from '@nestjs/common';

import { buildConfirmedOutboxRow } from '../completion-outbox';
import { CompletionReleaseReason, CompletionState } from '../completion.types';
import { CompletionRepository } from '../repository/completion.repository';

/**
 * AutoReleaseService — the server-authoritative auto-release transition (Spec 20).
 *
 * `autoReleaseDue(id)` is a single-winner `AWAITING_CONFIRMATION → AUTO_RELEASED` that co-persists
 * exactly one `release_intent(AUTO_RELEASE)` + `service_confirmed { trigger: AUTO_RELEASE }` in ONE
 * transaction. A completion confirmed/disputed first is no longer AWAITING_CONFIRMATION, so the
 * write is a no-op (rows=0). Never calls Stripe (the worker drives the intent). Idempotent.
 */
@Injectable()
export class AutoReleaseService {
  constructor(private readonly repository: CompletionRepository) {}

  /** Single-winner auto-release for a due completion. Returns true when this call won. */
  async autoReleaseDue(id: string): Promise<boolean> {
    const completion = await this.repository.findById(id);
    if (!completion || completion.state !== CompletionState.AWAITING_CONFIRMATION) {
      return false;
    }
    return this.repository.transition(
      id,
      CompletionState.AUTO_RELEASED,
      { releasedTrigger: CompletionReleaseReason.AUTO_RELEASE },
      { paymentId: completion.payment_id, reason: CompletionReleaseReason.AUTO_RELEASE },
      buildConfirmedOutboxRow(id, completion.offer_id, CompletionReleaseReason.AUTO_RELEASE),
    );
  }
}
