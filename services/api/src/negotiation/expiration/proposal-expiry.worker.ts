import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NegotiationRepository } from '../negotiation.repository';
import { NEGOTIATION_EXPIRY_SWEEP_INTERVAL_MS } from '../negotiation.constants';

/**
 * Proposal expiration worker.
 *
 * Periodically marks PENDING proposals whose response window (`expires_at`) has
 * elapsed as EXPIRED. This is distinct from SUPERSEDED (external invalidation):
 * EXPIRED means the proposal's own window elapsed, preserving auditability. A
 * thread whose offer is still ACTIVE stays OPEN so the Cleaner may submit a new
 * counteroffer.
 */
@Injectable()
export class ProposalExpiryWorker {
  private readonly logger = new Logger(ProposalExpiryWorker.name);

  constructor(private readonly negotiationRepo: NegotiationRepository) {}

  /** Sweep interval resolved from configuration. */
  static getSweepInterval(): number {
    return NEGOTIATION_EXPIRY_SWEEP_INTERVAL_MS;
  }

  /** Mark stale PENDING proposals as EXPIRED. */
  @Interval(ProposalExpiryWorker.getSweepInterval())
  async sweep(): Promise<void> {
    try {
      const expired = await this.negotiationRepo.expireStalePendingProposals();
      if (expired > 0) {
        this.logger.debug(`Expired ${expired} stale pending proposal(s)`);
      }
    } catch (error) {
      this.logger.error(`Proposal expiry sweep failed: ${String(error)}`);
    }
  }
}
