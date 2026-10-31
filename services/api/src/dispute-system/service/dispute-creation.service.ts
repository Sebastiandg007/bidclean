import { Injectable, Logger } from '@nestjs/common';

import {
  DISPUTE_EVIDENCE_WINDOW_MS,
  DISPUTE_REASON_CODES,
  DISPUTE_RESOLUTION_SLA_MS,
} from '../dispute.constants';
import { buildDisputeOpenedOutboxRow } from '../dispute-outbox';
import {
  DISPUTE_ERROR_MESSAGES,
  DisputeEvidenceKind,
  DisputeInitiatorRole,
  ServiceDisputedPayload,
} from '../dispute.types';
import { EscrowClient } from '../escrow/escrow.client';
import { DisputeRepository, UpstreamReferenceSpec } from '../repository/dispute.repository';

/** The default reason code used for a Spec 20-routed (Host-initiated) dispute when none is carried. */
const DEFAULT_ROUTED_REASON_CODE = 'QUALITY_INCOMPLETE';

/**
 * DisputeCreationService (Spec 21) — idempotent creation off the durable `service_disputed` fact.
 *
 * Resolves the participants + escrow `payment_id` server-side from the offer bound to the completion,
 * derives `phase` from Spec 9's authoritative `payout_status` (via `EscrowClient.readPaymentPhase`,
 * NEVER the completion decision) and snapshots it, snapshots the evidence/resolution deadlines from
 * config, and inserts the ACTIVE dispute (partial-unique idempotent) with the auto-linked upstream
 * references + the `OPEN` escrow-block intent + the `dispute_opened` outbox — all in ONE tx. Never
 * throws into the consumer batch on an expected idempotent no-op. Functions ≤30 lines, SRP.
 */
@Injectable()
export class DisputeCreationService {
  private readonly logger = new Logger(DisputeCreationService.name);

  constructor(
    private readonly repository: DisputeRepository,
    private readonly escrow: EscrowClient,
  ) {}

  /** Create the dispute for a `service_disputed` event (idempotent). */
  async createFromRouting(payload: ServiceDisputedPayload): Promise<void> {
    const resolved = await this.repository.resolvePaymentForOffer(payload.offerId);
    if (!resolved) {
      throw new Error(DISPUTE_ERROR_MESSAGES.PAYMENT_NOT_RESOLVED);
    }
    const phase = await this.escrow.readPaymentPhase(resolved.paymentId);
    const now = Date.now();
    const reasonCode = this.defaultReasonCode();

    const created = await this.repository.createDisputeActive(
      {
        disputeId: payload.disputeId,
        serviceCompletionId: payload.completionId,
        offerId: payload.offerId,
        paymentId: resolved.paymentId,
        // A Spec 20-routed dispute is Host-initiated (the Host declined to confirm).
        initiatorId: resolved.hostId,
        initiatorRole: DisputeInitiatorRole.HOST,
        hostId: resolved.hostId,
        cleanerId: resolved.cleanerId,
        phase,
        reasonCode,
        reasonText: null,
        evidenceDeadline: new Date(now + DISPUTE_EVIDENCE_WINDOW_MS),
        resolutionDeadline: new Date(now + DISPUTE_RESOLUTION_SLA_MS),
        references: this.buildUpstreamReferences(payload),
      },
      buildDisputeOpenedOutboxRow(payload.disputeId, payload.offerId, phase),
    );

    if (created) {
      this.logger.log(`Dispute created for completion ${payload.completionId}`);
    }
  }

  /** The typed upstream references auto-linked at creation (references, never byte copies). */
  private buildUpstreamReferences(payload: ServiceDisputedPayload): readonly UpstreamReferenceSpec[] {
    return [
      { kind: DisputeEvidenceKind.CHECKLIST_REF, ref: payload.offerId },
      { kind: DisputeEvidenceKind.CHECKLIST_PHOTO_REF, ref: payload.offerId },
      { kind: DisputeEvidenceKind.VERIFICATION_REF, ref: payload.offerId },
      { kind: DisputeEvidenceKind.ARRIVAL_REF, ref: payload.offerId },
    ];
  }

  /** The default reason code (first configured, falling back to a documented constant). */
  private defaultReasonCode(): string {
    return DISPUTE_REASON_CODES[0] ?? DEFAULT_ROUTED_REASON_CODE;
  }
}
