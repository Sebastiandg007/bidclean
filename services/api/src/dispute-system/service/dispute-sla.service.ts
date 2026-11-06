import { Injectable, Logger } from '@nestjs/common';

import {
  DISPUTE_FALLBACK_PARTIAL_REFUND_CENTS,
  DISPUTE_FALLBACK_RESOLUTION,
} from '../dispute.constants';
import { buildDisputeResolvedOutboxRow } from '../dispute-outbox';
import { DisputeResolution, DisputeState } from '../dispute.types';
import { mapResolutionToAction } from '../policy/resolution-mapping';
import { DisputeRepository } from '../repository/dispute.repository';

/**
 * DisputeSlaService (Spec 21) — the never-stuck fallback (single transaction).
 *
 * `expireDue` performs the single-winner `{OPEN|UNDER_REVIEW} → EXPIRED` conditional write, sets the
 * configured `DISPUTE_FALLBACK_RESOLUTION` (never null), inserts EXACTLY one fallback
 * `dispute_financial_intent`, and writes the `dispute_resolved` outbox — all in ONE tx. A rows=0
 * loser (resolved first) is a no-op. An `EXPIRED` dispute is NEVER `resolution = NULL`/intent-less.
 * The escrow is cleared only after Spec 9 accepts the fallback effect (same clear-escrow-LAST path).
 */
@Injectable()
export class DisputeSlaService {
  private readonly logger = new Logger(DisputeSlaService.name);
  private readonly fallbackResolution = DISPUTE_FALLBACK_RESOLUTION as DisputeResolution;

  constructor(private readonly repository: DisputeRepository) {}

  /** Expire a single due dispute with the configured fallback (single-winner, idempotent no-op if resolved). */
  async expireDue(disputeId: string): Promise<void> {
    const dispute = await this.repository.findById(disputeId);
    if (!dispute) {
      return;
    }
    const refundCents = this.fallbackRefundCents();
    const mapped = mapResolutionToAction(this.fallbackResolution, refundCents);

    const won = await this.repository.transitionTerminal(
      disputeId,
      DisputeState.EXPIRED,
      {
        resolution: this.fallbackResolution,
        resolutionRefundCents: mapped.amountCents,
        resolvedBy: 'SYSTEM',
      },
      { paymentId: dispute.payment_id, action: mapped.action, amountCents: mapped.amountCents },
      buildDisputeResolvedOutboxRow(disputeId, dispute.offer_id, this.fallbackResolution),
    );

    if (won) {
      this.logger.log(`Dispute ${disputeId} expired with fallback ${this.fallbackResolution}`);
    }
  }

  /** The requested fallback refund amount (only meaningful for a PARTIAL fallback). */
  private fallbackRefundCents(): number | null {
    return this.fallbackResolution === DisputeResolution.PARTIAL
      ? DISPUTE_FALLBACK_PARTIAL_REFUND_CENTS
      : null;
  }
}
