import { Injectable, Logger } from '@nestjs/common';

import { buildDisputeResolvedOutboxRow } from '../dispute-outbox';
import { DisputeResolution, DisputeState } from '../dispute.types';
import { mapResolutionToAction } from '../policy/resolution-mapping';
import { DisputeRepository, DisputeRow } from '../repository/dispute.repository';

/** The validated resolution input. */
export interface ResolveInput {
  readonly resolution: DisputeResolution;
  readonly refundCents: number | null;
}

/**
 * DisputeResolutionService (Spec 21) — the decision → durable financial intent (single transaction).
 *
 * `resolve` performs the single-winner `{OPEN|UNDER_REVIEW} → RESOLVED` conditional write, sets the
 * resolution fields, inserts EXACTLY one `dispute_financial_intent` (action from `resolution-mapping`),
 * and writes the `dispute_resolved` outbox — all in ONE tx. It NEVER calls Stripe in the request path
 * and NEVER clears the escrow here (clear-escrow-LAST). `resolution_refund_cents` is the REQUESTED
 * amount only; Spec 9 computes the applied amount. A loser (rows=0) on the same terminal is an
 * idempotent `200`; a terminal-different dispute is a `409`.
 */
@Injectable()
export class DisputeResolutionService {
  private readonly logger = new Logger(DisputeResolutionService.name);

  constructor(private readonly repository: DisputeRepository) {}

  /**
   * Resolve a dispute (single-winner + financial intent + outbox). Returns true for the winner
   * (rows=1); false when the dispute was already terminal (the caller maps that to idempotent/409).
   */
  async resolve(dispute: DisputeRow, resolvedBy: string, input: ResolveInput): Promise<boolean> {
    const mapped = mapResolutionToAction(input.resolution, input.refundCents);
    const won = await this.repository.transitionTerminal(
      dispute.id,
      DisputeState.RESOLVED,
      {
        resolution: input.resolution,
        resolutionRefundCents: mapped.amountCents,
        resolvedBy,
      },
      { paymentId: dispute.payment_id, action: mapped.action, amountCents: mapped.amountCents },
      buildDisputeResolvedOutboxRow(dispute.id, dispute.offer_id, input.resolution),
    );
    if (won) {
      this.logger.log(`Dispute ${dispute.id} resolved ${input.resolution}`);
    }
    return won;
  }
}
