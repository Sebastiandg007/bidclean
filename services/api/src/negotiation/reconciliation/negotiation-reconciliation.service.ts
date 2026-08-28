import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NegotiationRepository } from '../negotiation.repository';
import { NEGOTIATION_RECONCILE_INTERVAL_MS } from '../negotiation.constants';
import { SupersededReason } from '../negotiation.types';

/** Map an offer terminal state to the corresponding supersession reason */
const OFFER_STATE_TO_REASON: Record<string, SupersededReason> = {
  MATCHED: SupersededReason.OFFER_MATCHED,
  CANCELLED: SupersededReason.OFFER_CANCELLED,
  EXPIRED: SupersededReason.OFFER_EXPIRED,
};

/**
 * Negotiation reconciliation service.
 *
 * Periodic safety net (second line of defense behind OfferTerminalListener).
 * Because the system spans offers, negotiation, Centrifugo, and mobile — and
 * real-time delivery or the post-match write can fail — this sweep detects and
 * repairs inconsistent states:
 *
 * - Offer terminal (MATCHED/CANCELLED/EXPIRED) but a proposal is still PENDING
 *   -> supersede the PENDING proposals with the matching reason and close threads.
 *
 * This introduces NO distributed transaction; it makes post-match negotiation
 * state eventually consistent and retry-safe.
 */
@Injectable()
export class NegotiationReconciliationService {
  private readonly logger = new Logger(NegotiationReconciliationService.name);

  constructor(private readonly negotiationRepo: NegotiationRepository) {}

  /** Reconcile interval resolved from configuration. */
  static getReconcileInterval(): number {
    return NEGOTIATION_RECONCILE_INTERVAL_MS;
  }

  /** Detect and repair partial post-terminal negotiation state. */
  @Interval(NegotiationReconciliationService.getReconcileInterval())
  async reconcile(): Promise<void> {
    try {
      const rows = await this.negotiationRepo.findThreadsNeedingReconciliation();

      for (const row of rows) {
        const reason = OFFER_STATE_TO_REASON[row.offer_state];
        if (!reason) {
          continue;
        }
        const superseded = await this.negotiationRepo.supersedePendingForOffer(
          row.offer_id,
          reason,
        );
        await this.negotiationRepo.closeThreadsForOffer(row.offer_id);

        if (superseded > 0) {
          this.logger.warn(
            `Reconciliation repaired ${superseded} pending proposal(s) for terminal offer ${row.offer_id} (${row.offer_state})`,
          );
        }
      }
    } catch (error) {
      this.logger.error(`Negotiation reconciliation sweep failed: ${String(error)}`);
    }
  }
}
