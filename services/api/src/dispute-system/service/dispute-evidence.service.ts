import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  DISPUTE_EVIDENCE_ALLOWED_MIME_TYPES,
  DISPUTE_EVIDENCE_MAX_PER_DISPUTE,
  DISPUTE_EVIDENCE_MAX_SIZE_BYTES,
} from '../dispute.constants';
import {
  DISPUTE_ERROR_MESSAGES,
  DisputeEvidenceKind,
  DisputeEvidenceView,
  GrantStatus,
  TERMINAL_DISPUTE_STATES,
  isVisualEvidenceKind,
} from '../dispute.types';
import { DisputeEvidenceRepository, EvidenceRow } from '../repository/dispute-evidence.repository';
import { DisputeRepository, DisputeRow } from '../repository/dispute.repository';
import { DisputeUploadGrantRepository } from '../repository/dispute-upload-grant.repository';
import {
  DisputeEvidenceStorageService,
  InspectResult,
  UploadTarget,
} from '../storage/dispute-evidence-storage.service';
import { DisputeParticipationService } from './dispute-participation.service';
import { UpstreamEvidenceReader } from '../evidence/upstream-evidence.reader';

/** The finalize input (only `objectKey` is authoritative; the rest is advisory/re-inspected). */
export interface FinalizeEvidenceInput {
  readonly objectKey: string;
}

/** A resolved evidence read result: either a fresh visual URL or gated structured data. */
export type ResolvedEvidence =
  | { readonly kind: 'visual'; readonly playbackUrl: string; readonly expiresAt: string }
  | { readonly kind: 'structured'; readonly data: Record<string, unknown> };

/**
 * DisputeEvidenceService (Spec 21) — evidence grant / finalize / structured / resolve.
 *
 * Host/Cleaner photo uploads use the grant-gated MinIO pattern (grant persisted BEFORE the pre-signed
 * PUT; finalize re-checks grant + window + participant + server-inspects the object). Structured
 * submissions (HOST_REASON/NOTE) insert within the window. Reads are participant/resolver-gated:
 * visual kinds resolve to a short-lived pre-signed GET (key from DB, never client-supplied);
 * structured kinds resolve to gated data via `UpstreamEvidenceReader`, never a URL. Functions ≤30
 * lines, SRP.
 */
@Injectable()
export class DisputeEvidenceService {
  constructor(
    private readonly disputes: DisputeRepository,
    private readonly evidence: DisputeEvidenceRepository,
    private readonly grants: DisputeUploadGrantRepository,
    private readonly storage: DisputeEvidenceStorageService,
    private readonly participation: DisputeParticipationService,
    private readonly upstream: UpstreamEvidenceReader,
  ) {}

  /** Participant-gated, window-gated grant-first upload target for a photo. */
  async requestUpload(disputeId: string, userId: string): Promise<UploadTarget> {
    const dispute = await this.requireParticipantSubmittable(disputeId, userId);
    await this.assertCapAvailable(dispute.id);
    const objectKey = this.storage.generateObjectKey();
    await this.grants.createGrant(objectKey, dispute.id, userId);
    return this.storage.presignUploadTarget(objectKey);
  }

  /** Finalize an uploaded photo: re-verify grant + window + participant, server-inspect, insert, consume. */
  async finalizeUpload(
    disputeId: string,
    userId: string,
    input: FinalizeEvidenceInput,
  ): Promise<void> {
    const dispute = await this.requireParticipantSubmittable(disputeId, userId);
    const inspection = await this.storage.inspectObject(input.objectKey);
    this.assertObjectAcceptable(inspection);
    await this.disputes.withTransaction(async (manager) => {
      const grant = await this.grants.findConsumable(manager, input.objectKey);
      this.assertGrantUsable(grant, userId, dispute.id);
      const evidenceId = await this.evidence.insertHostPhoto(manager, {
        disputeId: dispute.id,
        submittedBy: userId,
        objectKey: input.objectKey,
        sizeBytes: inspection.sizeBytes,
        mimeType: inspection.contentType,
      });
      await this.grants.markConsumed(manager, input.objectKey, evidenceId);
    });
  }

  /** Add a structured Host/Cleaner submission (HOST_REASON/NOTE) within the window. */
  async addStructuredEvidence(
    disputeId: string,
    userId: string,
    kind: DisputeEvidenceKind,
    textValue: string,
  ): Promise<void> {
    const dispute = await this.requireParticipantSubmittable(disputeId, userId);
    await this.evidence.insertStructured({ disputeId: dispute.id, submittedBy: userId, kind, textValue });
  }

  /** All evidence refs for a dispute (for the view — never raw keys). */
  async listEvidence(disputeId: string): Promise<readonly DisputeEvidenceView[]> {
    const rows = await this.evidence.findByDispute(disputeId);
    return rows.map((row) => this.toView(row));
  }

  /** Participant/resolver-gated evidence read: visual → fresh URL, structured → gated data. */
  async resolveEvidence(
    dispute: DisputeRow,
    userId: string,
    evidenceId: string,
  ): Promise<ResolvedEvidence> {
    const canView = await this.participation.canView(userId, dispute);
    if (!canView) {
      throw new ForbiddenException(DISPUTE_ERROR_MESSAGES.NOT_AUTHORIZED);
    }
    const row = await this.evidence.findByIdForDispute(evidenceId, dispute.id);
    if (!row) {
      throw new NotFoundException(DISPUTE_ERROR_MESSAGES.EVIDENCE_NOT_FOUND);
    }
    const kind = row.kind as DisputeEvidenceKind;
    if (isVisualEvidenceKind(kind)) {
      return this.resolveVisual(row, dispute);
    }
    return { kind: 'structured', data: await this.resolveStructured(kind, dispute.offer_id, row) };
  }

  // ─── Guards / helpers ──────────────────────────────────────────────────────

  /** Require the caller is a participant, the dispute is non-terminal, and within the window. */
  private async requireParticipantSubmittable(
    disputeId: string,
    userId: string,
  ): Promise<DisputeRow> {
    const dispute = await this.disputes.findById(disputeId);
    if (!dispute) {
      throw new NotFoundException(DISPUTE_ERROR_MESSAGES.DISPUTE_NOT_FOUND);
    }
    if (!this.participation.isParticipant(userId, dispute)) {
      throw new ForbiddenException(DISPUTE_ERROR_MESSAGES.NOT_AUTHORIZED);
    }
    if ((TERMINAL_DISPUTE_STATES as readonly string[]).includes(dispute.state)) {
      throw new ConflictException(DISPUTE_ERROR_MESSAGES.ALREADY_TERMINAL);
    }
    if (dispute.evidence_deadline.getTime() <= Date.now()) {
      throw new ConflictException(DISPUTE_ERROR_MESSAGES.EVIDENCE_WINDOW_CLOSED);
    }
    return dispute;
  }

  /** Assert the per-dispute photo cap (committed + reserved grants) is not reached. */
  private async assertCapAvailable(disputeId: string): Promise<void> {
    const committed = await this.evidence.countHostPhotos(disputeId);
    const reserved = await this.grants.countActiveGrants(disputeId, new Date());
    if (committed + reserved >= DISPUTE_EVIDENCE_MAX_PER_DISPUTE) {
      throw new BadRequestException(DISPUTE_ERROR_MESSAGES.EVIDENCE_CAP_REACHED);
    }
  }

  /** Server-authoritative object validation (client metadata advisory). */
  private assertObjectAcceptable(inspection: InspectResult): void {
    if (!inspection.exists) {
      throw new BadRequestException(DISPUTE_ERROR_MESSAGES.OBJECT_MISSING);
    }
    if (inspection.sizeBytes > DISPUTE_EVIDENCE_MAX_SIZE_BYTES) {
      throw new BadRequestException(DISPUTE_ERROR_MESSAGES.OBJECT_TOO_LARGE);
    }
    if (!DISPUTE_EVIDENCE_ALLOWED_MIME_TYPES.includes(inspection.contentType)) {
      throw new BadRequestException(DISPUTE_ERROR_MESSAGES.OBJECT_INVALID_TYPE);
    }
    if (inspection.width === null || inspection.height === null) {
      throw new BadRequestException(DISPUTE_ERROR_MESSAGES.OBJECT_UNPROBEABLE);
    }
  }

  /** Re-verify the grant (exists, issued to caller, matching dispute, unexpired, ISSUED). */
  private assertGrantUsable(
    grant: { disputeId: string; issuedToUserId: string | null; status: string; expiresAt: Date } | null,
    userId: string,
    disputeId: string,
  ): void {
    if (!grant || grant.disputeId !== disputeId || grant.issuedToUserId !== userId) {
      throw new ForbiddenException(DISPUTE_ERROR_MESSAGES.GRANT_NOT_FOUND);
    }
    if (grant.status !== GrantStatus.ISSUED || grant.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException(DISPUTE_ERROR_MESSAGES.GRANT_UNUSABLE);
    }
  }

  /** Resolve a visual evidence row to a fresh pre-signed GET (key from DB only). */
  private async resolveVisual(row: EvidenceRow, dispute: DisputeRow): Promise<ResolvedEvidence> {
    if (row.kind === DisputeEvidenceKind.HOST_PHOTO) {
      if (row.object_key === null || row.object_deleted_at !== null) {
        throw new NotFoundException(DISPUTE_ERROR_MESSAGES.OBJECT_MISSING);
      }
      const target = await this.storage.getPlaybackTarget(row.object_key);
      return { kind: 'visual', playbackUrl: target.playbackUrl, expiresAt: target.expiresAt };
    }
    // CHECKLIST_PHOTO_REF resolves to the upstream checklist photo summary (structured, gated).
    const data = await this.upstream.readChecklistRef(dispute.offer_id);
    return { kind: 'structured', data: { ...data } };
  }

  /** Resolve a structured evidence row to gated data (never a URL). */
  private async resolveStructured(
    kind: DisputeEvidenceKind,
    offerId: string,
    row: EvidenceRow,
  ): Promise<Record<string, unknown>> {
    switch (kind) {
      case DisputeEvidenceKind.CHECKLIST_REF:
        return { ...(await this.upstream.readChecklistRef(offerId)) };
      case DisputeEvidenceKind.VERIFICATION_REF:
        return { ...(await this.upstream.readVerificationRef(offerId)) };
      case DisputeEvidenceKind.ARRIVAL_REF:
        return { ...(await this.upstream.readArrivalRef(offerId)) };
      default:
        return { textValue: row.text_value };
    }
  }

  /** Map an evidence row to its client-facing view (never a raw key). */
  private toView(row: EvidenceRow): DisputeEvidenceView {
    return {
      id: row.id,
      kind: row.kind as DisputeEvidenceKind,
      submittedBy: row.submitted_by,
      createdAt: row.created_at.toISOString(),
    };
  }
}
