import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import {
  DISPUTE_ERROR_MESSAGES,
  DisputeInitiatorRole,
  DisputePhase,
  DisputeResolution,
  DisputeState,
  DisputeView,
} from '../dispute.types';
import { DisputeRepository, DisputeRow } from '../repository/dispute.repository';
import { DisputeEvidenceService } from './dispute-evidence.service';
import { DisputeParticipationService } from './dispute-participation.service';

/**
 * DisputeViewService (Spec 21) — the participant/resolver-gated reconciliation read.
 *
 * `getDispute` authorizes the caller (participant OR resolver), then returns the authoritative
 * PostgreSQL state + phase + resolution + snapshotted deadlines + evidence refs — NEVER the internal
 * intent fields (attempt/lease/outcome/effective amount) and never a raw object key. A non-authorized
 * caller receives `403` and learns nothing.
 */
@Injectable()
export class DisputeViewService {
  constructor(
    private readonly repository: DisputeRepository,
    private readonly participation: DisputeParticipationService,
    private readonly evidence: DisputeEvidenceService,
  ) {}

  /** Fetch the dispute (participant/resolver-gated). Also returns the row for evidence resolution. */
  async requireViewableDispute(disputeId: string, userId: string): Promise<DisputeRow> {
    const dispute = await this.repository.findById(disputeId);
    if (!dispute) {
      throw new NotFoundException(DISPUTE_ERROR_MESSAGES.DISPUTE_NOT_FOUND);
    }
    const canView = await this.participation.canView(userId, dispute);
    if (!canView) {
      throw new ForbiddenException(DISPUTE_ERROR_MESSAGES.NOT_AUTHORIZED);
    }
    return dispute;
  }

  /** The authoritative dispute view for `GET /disputes/:id`. */
  async getDispute(disputeId: string, userId: string): Promise<DisputeView> {
    const dispute = await this.requireViewableDispute(disputeId, userId);
    const evidence = await this.evidence.listEvidence(dispute.id);
    return {
      id: dispute.id,
      serviceCompletionId: dispute.service_completion_id,
      offerId: dispute.offer_id,
      state: dispute.state as DisputeState,
      phase: dispute.phase as DisputePhase,
      initiatorRole: dispute.initiator_role as DisputeInitiatorRole,
      reasonCode: dispute.reason_code,
      resolution: dispute.resolution as DisputeResolution | null,
      resolutionRefundCents: dispute.resolution_refund_cents,
      evidenceDeadline: dispute.evidence_deadline.toISOString(),
      resolutionDeadline: dispute.resolution_deadline.toISOString(),
      resolvedAt: dispute.resolved_at?.toISOString() ?? null,
      evidence,
    };
  }
}
