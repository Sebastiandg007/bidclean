import { EntityManager } from 'typeorm';

import { OutboxRow } from '../../common/outbox/outbox-writer';
import {
  ACTIVE_DISPUTE_STATES,
  DisputeEvidenceKind,
  DisputePhase,
  DisputeResolution,
  DisputeState,
  EscrowActionOutcome,
  EscrowActionResult,
  EscrowIntentTarget,
  FinancialIntentAction,
  GrantStatus,
  IntentStatus,
  TERMINAL_DISPUTE_STATES,
} from '../dispute.types';
import {
  CreateDisputeParams,
  DisputeRow,
  FinancialIntentSpec,
  TerminalFields,
} from '../repository/dispute.repository';
import { EscrowIntentRow } from '../repository/dispute-escrow-intent.repository';
import { FinancialIntentRow } from '../repository/dispute-financial-intent.repository';
import { EvidenceRow } from '../repository/dispute-evidence.repository';
import { ConsumableGrant } from '../repository/dispute-upload-grant.repository';

/**
 * In-memory test harness modelling the dispute-system DB invariants (mirrors the service-completion
 * harness). The REAL services run against deterministic fakes so property-based tests can quantify
 * over behaviour. Concurrency is simulated by serializing operations — the production single-winner
 * conditional writes enforce the same "exactly one wins" semantics these fakes model. The
 * `FakeEscrowClient` is the mocked Spec 9 seam (no Stripe). BullMQ/Postgres/MinIO are modelled here.
 */

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

/** A stored dispute (mutable). */
export interface StoredDispute {
  id: string;
  serviceCompletionId: string;
  offerId: string;
  paymentId: string;
  initiatorId: string | null;
  initiatorRole: string;
  hostId: string | null;
  cleanerId: string | null;
  phase: string;
  reasonCode: string;
  reasonText: string | null;
  state: string;
  resolution: string | null;
  resolutionRefundCents: number | null;
  evidenceDeadline: Date;
  resolutionDeadline: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
}

/** A stored escrow-block intent (mutable). */
export interface StoredEscrowIntent {
  id: string;
  disputeId: string | null;
  paymentId: string;
  target: string;
  status: string;
  attempt: number;
  leaseUntil: Date | null;
  createdAt: number;
}

/** A stored financial intent (mutable). */
export interface StoredFinancialIntent {
  id: string;
  disputeId: string | null;
  paymentId: string;
  action: string;
  amountCents: number | null;
  status: string;
  attempt: number;
  leaseUntil: Date | null;
  outcome: string | null;
  outcomeReason: string | null;
  effectiveAmountCents: number | null;
  createdAt: number;
}

/** A stored evidence row (mutable). */
export interface StoredEvidence {
  id: string;
  disputeId: string;
  submittedBy: string | null;
  kind: string;
  objectKey: string | null;
  ref: string | null;
  textValue: string | null;
  objectDeletedAt: Date | null;
  uploadedAt: Date | null;
  createdAt: Date;
}

/** A stored upload grant (mutable). */
export interface StoredGrant {
  objectKey: string;
  disputeId: string;
  issuedToUserId: string | null;
  status: string;
  expiresAt: Date;
}

/** A stored object-deletion tombstone (mutable). */
export interface StoredTombstone {
  objectKey: string;
  status: string;
  createdAt: number;
}

/** A payment view for phase derivation + P15 settlement (mocked Spec 9 state). */
export interface StoredPayment {
  paymentId: string;
  offerId: string;
  hostId: string;
  cleanerId: string;
  payoutStatus: DisputePhase;
  disputeStatus: 'NONE' | 'OPEN';
  disputeSettledAt: Date | null;
}

/** The shared deterministic in-memory store. */
export class FakeStore {
  disputes = new Map<string, StoredDispute>();
  escrowIntents: StoredEscrowIntent[] = [];
  financialIntents: StoredFinancialIntent[] = [];
  evidence: StoredEvidence[] = [];
  grants = new Map<string, StoredGrant>();
  tombstones = new Map<string, StoredTombstone>();
  payments = new Map<string, StoredPayment>();
  offerToPayment = new Map<string, string>();
  outbox: OutboxRow[] = [];
  clock = Date.now();

  now(): number {
    return this.clock;
  }

  setPayment(payment: StoredPayment): void {
    this.payments.set(payment.paymentId, payment);
    this.offerToPayment.set(payment.offerId, payment.paymentId);
  }
}

/** Fake DisputeRepository over the shared store (mirrors the real SQL semantics). */
export class FakeDisputeRepository {
  constructor(private readonly store: FakeStore) {}

  async createDisputeActive(
    params: CreateDisputeParams,
    openedOutbox: OutboxRow,
  ): Promise<string | null> {
    for (const existing of this.store.disputes.values()) {
      if (
        existing.serviceCompletionId === params.serviceCompletionId &&
        (ACTIVE_DISPUTE_STATES as readonly string[]).includes(existing.state)
      ) {
        return null; // partial-unique active → idempotent no-op
      }
    }
    const id = nextId('dispute');
    this.store.disputes.set(id, {
      id,
      serviceCompletionId: params.serviceCompletionId,
      offerId: params.offerId,
      paymentId: params.paymentId,
      initiatorId: params.initiatorId,
      initiatorRole: params.initiatorRole,
      hostId: params.hostId,
      cleanerId: params.cleanerId,
      phase: params.phase,
      reasonCode: params.reasonCode,
      reasonText: params.reasonText,
      state: DisputeState.OPEN,
      resolution: null,
      resolutionRefundCents: null,
      evidenceDeadline: params.evidenceDeadline,
      resolutionDeadline: params.resolutionDeadline,
      resolvedAt: null,
      resolvedBy: null,
    });
    for (const reference of params.references) {
      this.store.evidence.push({
        id: nextId('ev'),
        disputeId: id,
        submittedBy: null,
        kind: reference.kind,
        objectKey: null,
        ref: reference.ref,
        textValue: null,
        objectDeletedAt: null,
        uploadedAt: null,
        createdAt: new Date(this.store.now()),
      });
    }
    this.store.escrowIntents.push({
      id: nextId('esc'),
      disputeId: id,
      paymentId: params.paymentId,
      target: EscrowIntentTarget.OPEN,
      status: IntentStatus.PENDING,
      attempt: 0,
      leaseUntil: null,
      createdAt: this.store.now(),
    });
    this.pushOutbox({ ...openedOutbox, aggregateId: id });
    return id;
  }

  async transitionState(
    id: string,
    expected: DisputeState,
    next: DisputeState,
  ): Promise<boolean> {
    const dispute = this.store.disputes.get(id);
    if (!dispute || dispute.state !== expected) {
      return false;
    }
    dispute.state = next;
    return true;
  }

  async transitionTerminal(
    id: string,
    next: DisputeState,
    fields: TerminalFields,
    financialIntent: FinancialIntentSpec,
    resolvedOutbox: OutboxRow,
  ): Promise<boolean> {
    const dispute = this.store.disputes.get(id);
    if (!dispute || !(ACTIVE_DISPUTE_STATES as readonly string[]).includes(dispute.state)) {
      return false; // single-winner: only from an active state
    }
    dispute.state = next;
    dispute.resolution = fields.resolution;
    dispute.resolutionRefundCents = fields.resolutionRefundCents;
    dispute.resolvedAt = new Date(this.store.now());
    dispute.resolvedBy = fields.resolvedBy;
    // uq_dispute_financial_intent_dispute → at most one per dispute.
    if (!this.store.financialIntents.some((i) => i.disputeId === id)) {
      this.store.financialIntents.push({
        id: nextId('fin'),
        disputeId: id,
        paymentId: financialIntent.paymentId,
        action: financialIntent.action,
        amountCents: financialIntent.amountCents,
        status: IntentStatus.PENDING,
        attempt: 0,
        leaseUntil: null,
        outcome: null,
        outcomeReason: null,
        effectiveAmountCents: null,
        createdAt: this.store.now(),
      });
    }
    this.pushOutbox(resolvedOutbox);
    return true;
  }

  async enqueueClearIntent(disputeId: string | null, paymentId: string): Promise<void> {
    const exists = this.store.escrowIntents.some(
      (i) => i.disputeId === disputeId && disputeId !== null && i.target === EscrowIntentTarget.NONE,
    );
    if (exists) {
      return;
    }
    this.store.escrowIntents.push({
      id: nextId('esc'),
      disputeId,
      paymentId,
      target: EscrowIntentTarget.NONE,
      status: IntentStatus.PENDING,
      attempt: 0,
      leaseUntil: null,
      createdAt: this.store.now(),
    });
  }

  async findById(id: string): Promise<DisputeRow | null> {
    const dispute = this.store.disputes.get(id);
    return dispute ? this.toRow(dispute) : null;
  }

  async findByCompletionActive(completionId: string): Promise<DisputeRow | null> {
    for (const dispute of this.store.disputes.values()) {
      if (
        dispute.serviceCompletionId === completionId &&
        (ACTIVE_DISPUTE_STATES as readonly string[]).includes(dispute.state)
      ) {
        return this.toRow(dispute);
      }
    }
    return null;
  }

  async findDueForSla(now: Date, limit: number): Promise<string[]> {
    return [...this.store.disputes.values()]
      .filter(
        (d) =>
          (ACTIVE_DISPUTE_STATES as readonly string[]).includes(d.state) &&
          d.resolutionDeadline.getTime() <= now.getTime(),
      )
      .sort((a, b) => a.resolutionDeadline.getTime() - b.resolutionDeadline.getTime())
      .slice(0, limit)
      .map((d) => d.id);
  }

  async resolvePaymentForOffer(
    offerId: string,
  ): Promise<{ paymentId: string; hostId: string; cleanerId: string } | null> {
    const paymentId = this.store.offerToPayment.get(offerId);
    if (paymentId === undefined) {
      return null;
    }
    const payment = this.store.payments.get(paymentId);
    if (!payment) {
      return null;
    }
    return { paymentId, hostId: payment.hostId, cleanerId: payment.cleanerId };
  }

  async withTransaction<T>(fn: (manager: EntityManager) => Promise<T>): Promise<T> {
    return fn({} as EntityManager);
  }

  private pushOutbox(outbox: OutboxRow): void {
    if (!this.store.outbox.some((row) => row.eventId === outbox.eventId)) {
      this.store.outbox.push(outbox);
    }
  }

  private toRow(dispute: StoredDispute): DisputeRow {
    return {
      id: dispute.id,
      service_completion_id: dispute.serviceCompletionId,
      offer_id: dispute.offerId,
      payment_id: dispute.paymentId,
      initiator_id: dispute.initiatorId,
      initiator_role: dispute.initiatorRole,
      host_id: dispute.hostId,
      cleaner_id: dispute.cleanerId,
      phase: dispute.phase,
      reason_code: dispute.reasonCode,
      reason_text: dispute.reasonText,
      state: dispute.state,
      resolution: dispute.resolution,
      resolution_refund_cents: dispute.resolutionRefundCents,
      evidence_deadline: dispute.evidenceDeadline,
      resolution_deadline: dispute.resolutionDeadline,
      resolved_at: dispute.resolvedAt,
    };
  }
}

/** Fake DisputeEscrowIntentRepository (mirrors the lease-claim semantics). */
export class FakeEscrowIntentRepository {
  constructor(private readonly store: FakeStore) {}

  async drainClaimable(limit: number): Promise<EscrowIntentRow[]> {
    return this.claimable().slice(0, limit).map((i) => this.toRow(i));
  }

  async claimForDispatch(id: string, leaseMs: number): Promise<boolean> {
    const intent = this.store.escrowIntents.find((i) => i.id === id);
    if (!intent || !this.isClaimable(intent)) {
      return false;
    }
    intent.status = IntentStatus.DISPATCHED;
    intent.leaseUntil = new Date(this.store.now() + leaseMs);
    return true;
  }

  async markAccepted(id: string): Promise<void> {
    const intent = this.store.escrowIntents.find((i) => i.id === id);
    if (intent && intent.status !== IntentStatus.ACCEPTED) {
      intent.status = IntentStatus.ACCEPTED;
    }
  }

  async markFailedRetryable(id: string): Promise<void> {
    const intent = this.store.escrowIntents.find((i) => i.id === id);
    if (intent && intent.status !== IntentStatus.ACCEPTED) {
      intent.status = IntentStatus.FAILED_RETRYABLE;
      intent.attempt += 1;
      intent.leaseUntil = null;
    }
  }

  async findByDispute(disputeId: string): Promise<EscrowIntentRow[]> {
    return this.store.escrowIntents.filter((i) => i.disputeId === disputeId).map((i) => this.toRow(i));
  }

  private isClaimable(intent: StoredEscrowIntent): boolean {
    const now = this.store.now();
    return (
      intent.status === IntentStatus.PENDING ||
      intent.status === IntentStatus.FAILED_RETRYABLE ||
      (intent.status === IntentStatus.DISPATCHED &&
        intent.leaseUntil !== null &&
        intent.leaseUntil.getTime() <= now)
    );
  }

  private claimable(): StoredEscrowIntent[] {
    return this.store.escrowIntents
      .filter((i) => this.isClaimable(i))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  private toRow(i: StoredEscrowIntent): EscrowIntentRow {
    return {
      id: i.id,
      dispute_id: i.disputeId,
      payment_id: i.paymentId,
      target: i.target,
      status: i.status,
      attempt: i.attempt,
    };
  }
}

/** Fake DisputeFinancialIntentRepository (mirrors the lease-claim + outcome semantics). */
export class FakeFinancialIntentRepository {
  constructor(private readonly store: FakeStore) {}

  async drainClaimable(limit: number): Promise<FinancialIntentRow[]> {
    return this.claimable().slice(0, limit).map((i) => this.toRow(i));
  }

  async claimForDispatch(id: string, leaseMs: number): Promise<boolean> {
    const intent = this.store.financialIntents.find((i) => i.id === id);
    if (!intent || !this.isClaimable(intent)) {
      return false;
    }
    intent.status = IntentStatus.DISPATCHED;
    intent.leaseUntil = new Date(this.store.now() + leaseMs);
    return true;
  }

  async markAccepted(
    id: string,
    outcome: EscrowActionResult,
    effectiveAmountCents: number | null,
  ): Promise<void> {
    const intent = this.store.financialIntents.find((i) => i.id === id);
    if (intent && intent.status !== IntentStatus.ACCEPTED && intent.status !== IntentStatus.ACTION_BLOCKED) {
      intent.status = IntentStatus.ACCEPTED;
      intent.outcome = outcome;
      intent.effectiveAmountCents = effectiveAmountCents;
    }
  }

  async markActionBlocked(id: string, outcomeReason: string | null): Promise<void> {
    const intent = this.store.financialIntents.find((i) => i.id === id);
    if (intent && intent.status !== IntentStatus.ACCEPTED && intent.status !== IntentStatus.ACTION_BLOCKED) {
      intent.status = IntentStatus.ACTION_BLOCKED;
      intent.outcome = EscrowActionResult.BLOCKED;
      intent.outcomeReason = outcomeReason;
    }
  }

  async markFailedRetryable(id: string): Promise<void> {
    const intent = this.store.financialIntents.find((i) => i.id === id);
    if (intent && intent.status !== IntentStatus.ACCEPTED && intent.status !== IntentStatus.ACTION_BLOCKED) {
      intent.status = IntentStatus.FAILED_RETRYABLE;
      intent.attempt += 1;
      intent.leaseUntil = null;
    }
  }

  async findByDispute(disputeId: string): Promise<FinancialIntentRow | null> {
    const intent = this.store.financialIntents.find((i) => i.disputeId === disputeId);
    return intent ? this.toRow(intent) : null;
  }

  private isClaimable(intent: StoredFinancialIntent): boolean {
    const now = this.store.now();
    return (
      intent.status === IntentStatus.PENDING ||
      intent.status === IntentStatus.FAILED_RETRYABLE ||
      (intent.status === IntentStatus.DISPATCHED &&
        intent.leaseUntil !== null &&
        intent.leaseUntil.getTime() <= now)
    );
  }

  private claimable(): StoredFinancialIntent[] {
    return this.store.financialIntents
      .filter((i) => this.isClaimable(i))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  private toRow(i: StoredFinancialIntent): FinancialIntentRow {
    return {
      id: i.id,
      dispute_id: i.disputeId,
      payment_id: i.paymentId,
      action: i.action,
      amount_cents: i.amountCents,
      status: i.status,
      attempt: i.attempt,
    };
  }
}

/** Fake DisputeEvidenceRepository. */
export class FakeEvidenceRepository {
  constructor(private readonly store: FakeStore) {}

  async insertReference(): Promise<void> {
    // References are inserted by createDisputeActive in the fake dispute repo.
  }

  async insertStructured(params: {
    disputeId: string;
    submittedBy: string;
    kind: DisputeEvidenceKind;
    textValue: string;
  }): Promise<string> {
    const id = nextId('ev');
    this.store.evidence.push({
      id,
      disputeId: params.disputeId,
      submittedBy: params.submittedBy,
      kind: params.kind,
      objectKey: null,
      ref: null,
      textValue: params.textValue,
      objectDeletedAt: null,
      uploadedAt: null,
      createdAt: new Date(this.store.now()),
    });
    return id;
  }

  async insertHostPhoto(
    _manager: EntityManager,
    params: { disputeId: string; submittedBy: string; objectKey: string; sizeBytes: number; mimeType: string },
  ): Promise<string> {
    const id = nextId('ev');
    this.store.evidence.push({
      id,
      disputeId: params.disputeId,
      submittedBy: params.submittedBy,
      kind: DisputeEvidenceKind.HOST_PHOTO,
      objectKey: params.objectKey,
      ref: null,
      textValue: null,
      objectDeletedAt: null,
      uploadedAt: new Date(this.store.now()),
      createdAt: new Date(this.store.now()),
    });
    return id;
  }

  async countHostPhotos(disputeId: string): Promise<number> {
    return this.store.evidence.filter(
      (e) => e.disputeId === disputeId && e.kind === DisputeEvidenceKind.HOST_PHOTO,
    ).length;
  }

  async findByDispute(disputeId: string): Promise<EvidenceRow[]> {
    return this.store.evidence.filter((e) => e.disputeId === disputeId).map((e) => this.toRow(e));
  }

  async findByIdForDispute(evidenceId: string, disputeId: string): Promise<EvidenceRow | null> {
    const row = this.store.evidence.find((e) => e.id === evidenceId && e.disputeId === disputeId);
    return row ? this.toRow(row) : null;
  }

  async findRetentionDeletable(
    before: Date,
    limit: number,
  ): Promise<Array<{ evidenceId: string; objectKey: string }>> {
    return this.store.evidence
      .filter((e) => {
        const dispute = this.store.disputes.get(e.disputeId);
        return (
          e.objectKey !== null &&
          e.objectDeletedAt === null &&
          e.uploadedAt !== null &&
          e.uploadedAt.getTime() < before.getTime() &&
          dispute !== undefined &&
          (TERMINAL_DISPUTE_STATES as readonly string[]).includes(dispute.state)
        );
      })
      .slice(0, limit)
      .map((e) => ({ evidenceId: e.id, objectKey: e.objectKey as string }));
  }

  async markObjectDeleted(evidenceId: string): Promise<void> {
    const row = this.store.evidence.find((e) => e.id === evidenceId);
    if (row && row.objectDeletedAt === null) {
      row.objectDeletedAt = new Date(this.store.now());
    }
  }

  private toRow(e: StoredEvidence): EvidenceRow {
    return {
      id: e.id,
      dispute_id: e.disputeId,
      submitted_by: e.submittedBy,
      kind: e.kind,
      object_key: e.objectKey,
      ref: e.ref,
      text_value: e.textValue,
      object_deleted_at: e.objectDeletedAt,
      created_at: e.createdAt,
    };
  }
}

/** Fake DisputeUploadGrantRepository (grant persisted before use; single-use consumption). */
export class FakeGrantRepository {
  constructor(private readonly store: FakeStore) {}

  async createGrant(objectKey: string, disputeId: string, issuedToUserId: string): Promise<void> {
    this.store.grants.set(objectKey, {
      objectKey,
      disputeId,
      issuedToUserId,
      status: GrantStatus.ISSUED,
      expiresAt: new Date(this.store.now() + 600_000),
    });
  }

  async countActiveGrants(disputeId: string, now: Date): Promise<number> {
    let count = 0;
    for (const grant of this.store.grants.values()) {
      if (
        grant.disputeId === disputeId &&
        grant.status === GrantStatus.ISSUED &&
        grant.expiresAt.getTime() > now.getTime()
      ) {
        count += 1;
      }
    }
    return count;
  }

  async findConsumable(_manager: EntityManager, objectKey: string): Promise<ConsumableGrant | null> {
    const grant = this.store.grants.get(objectKey);
    if (!grant) {
      return null;
    }
    return {
      objectKey: grant.objectKey,
      disputeId: grant.disputeId,
      issuedToUserId: grant.issuedToUserId,
      status: grant.status,
      expiresAt: grant.expiresAt,
    };
  }

  async markConsumed(_manager: EntityManager, objectKey: string): Promise<void> {
    const grant = this.store.grants.get(objectKey);
    if (grant) {
      grant.status = GrantStatus.CONSUMED;
    }
  }

  async findStaleGrants(now: Date, limit: number): Promise<Array<{ objectKey: string }>> {
    const stale: Array<{ objectKey: string }> = [];
    for (const grant of this.store.grants.values()) {
      if (grant.status === GrantStatus.ISSUED && grant.expiresAt.getTime() < now.getTime()) {
        stale.push({ objectKey: grant.objectKey });
      }
    }
    return stale.slice(0, limit);
  }

  async markClosed(objectKey: string, status: GrantStatus): Promise<void> {
    const grant = this.store.grants.get(objectKey);
    if (grant && grant.status === GrantStatus.ISSUED) {
      grant.status = status;
    }
  }
}

/** Fake DisputeObjectDeletionRepository. */
export class FakeObjectDeletionRepository {
  constructor(private readonly store: FakeStore) {}

  async drainPending(limit: number): Promise<Array<{ objectKey: string }>> {
    return [...this.store.tombstones.values()]
      .filter((t) => t.status === 'PENDING')
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, limit)
      .map((t) => ({ objectKey: t.objectKey }));
  }

  async markDone(objectKey: string): Promise<void> {
    const tombstone = this.store.tombstones.get(objectKey);
    if (tombstone) {
      tombstone.status = 'DONE';
    }
  }
}

/** The programmable outcome the FakeEscrowClient returns for the next release/refund. */
export interface EscrowScript {
  releaseOutcome?: EscrowActionOutcome;
  refundOutcome?: EscrowActionOutcome;
  throwOnce?: boolean;
}

/**
 * Fake EscrowClient — the mocked Spec 9 seam (no Stripe). Derives phase from the stored payment,
 * records setDisputeStatus calls, and returns the scripted outcome (defaulting to a sensible one that
 * honours the P15 settled-guard using the stored payment's `disputeSettledAt`).
 */
export class FakeEscrowClient {
  public setStatusCalls: Array<{ paymentId: string; target: 'OPEN' | 'NONE' }> = [];
  public releaseCalls: string[] = [];
  public refundCalls: Array<{ paymentId: string; amountCents: number | null }> = [];
  private script: EscrowScript = {};

  constructor(private readonly store: FakeStore) {}

  program(script: EscrowScript): void {
    this.script = script;
  }

  async readPaymentPhase(paymentId: string): Promise<DisputePhase> {
    return this.store.payments.get(paymentId)?.payoutStatus ?? DisputePhase.PRE_RELEASE;
  }

  async setDisputeStatus(paymentId: string, target: 'OPEN' | 'NONE'): Promise<void> {
    this.setStatusCalls.push({ paymentId, target });
    const payment = this.store.payments.get(paymentId);
    if (payment) {
      payment.disputeStatus = target === 'OPEN' ? 'OPEN' : 'NONE';
    }
  }

  async release(paymentId: string): Promise<EscrowActionOutcome> {
    this.releaseCalls.push(paymentId);
    return this.applyOutcome(paymentId, this.script.releaseOutcome);
  }

  async refund(paymentId: string, amountCents: number | null): Promise<EscrowActionOutcome> {
    this.refundCalls.push({ paymentId, amountCents });
    return this.applyOutcome(paymentId, this.script.refundOutcome);
  }

  /** Apply the P15 settled-guard then the scripted (or default APPLIED) outcome. */
  private applyOutcome(
    paymentId: string,
    scripted: EscrowActionOutcome | undefined,
  ): EscrowActionOutcome {
    if (this.script.throwOnce) {
      this.script.throwOnce = false;
      throw new Error('transient');
    }
    const payment = this.store.payments.get(paymentId);
    if (payment && payment.disputeSettledAt !== null) {
      return { result: EscrowActionResult.BLOCKED, reason: 'PAYMENT_ALREADY_SETTLED' };
    }
    const outcome = scripted ?? { result: EscrowActionResult.APPLIED, effectiveAmountCents: 0 };
    if (payment && outcome.result !== EscrowActionResult.BLOCKED) {
      payment.disputeSettledAt = new Date(this.store.now());
    }
    return outcome;
  }
}

/** Fake storage service (no MinIO). */
export class FakeStorageService {
  public deleted: string[] = [];
  private keySeq = 0;

  generateObjectKey(): string {
    this.keySeq += 1;
    return `obj-${this.keySeq}`;
  }

  async presignUploadTarget(objectKey: string): Promise<{ objectKey: string; uploadUrl: string; expiresAt: string }> {
    return { objectKey, uploadUrl: `https://minio.test/put/${objectKey}`, expiresAt: new Date().toISOString() };
  }

  async getPlaybackTarget(objectKey: string): Promise<{ playbackUrl: string; expiresAt: string }> {
    return { playbackUrl: `https://minio.test/get/${objectKey}`, expiresAt: new Date().toISOString() };
  }

  async inspectObject(): Promise<{ exists: boolean; sizeBytes: number; contentType: string; width: number | null; height: number | null }> {
    return { exists: true, sizeBytes: 1024, contentType: 'image/jpeg', width: 100, height: 100 };
  }

  async deleteObjectSafe(objectKey: string): Promise<void> {
    this.deleted.push(objectKey);
  }
}

/** Fake participation service backed by a resolver-id set. */
export class FakeParticipationService {
  constructor(private readonly resolvers: ReadonlySet<string>) {}

  isParticipant(userId: string, dispute: DisputeRow): boolean {
    return dispute.host_id === userId || dispute.cleaner_id === userId;
  }

  async isResolver(userId: string): Promise<boolean> {
    return this.resolvers.has(userId);
  }

  async canView(userId: string, dispute: DisputeRow): Promise<boolean> {
    return this.isParticipant(userId, dispute) || this.isResolver(userId);
  }
}

/** Fake upstream-evidence reader returning deterministic structured data. */
export class FakeUpstreamEvidenceReader {
  async readChecklistRef(): Promise<Record<string, unknown>> {
    return { runId: 'run-1', state: 'COMPLETED', totalTasks: 3, completedTasks: 3, completedAt: null };
  }

  async readVerificationRef(): Promise<Record<string, unknown>> {
    return { verificationId: 'ver-1', state: 'MATCH', decision: 'MATCH' };
  }

  async readArrivalRef(): Promise<Record<string, unknown>> {
    return { sessionId: 'sess-1', state: 'IN_PROGRESS', arrivedAt: null, endedReason: null };
  }
}

/** Convenience: map fallback resolution to a financial action for assertions. */
export function actionForResolution(resolution: DisputeResolution): FinancialIntentAction {
  switch (resolution) {
    case DisputeResolution.FAVOR_CLEANER:
      return FinancialIntentAction.RELEASE;
    case DisputeResolution.FAVOR_HOST:
      return FinancialIntentAction.FULL_REFUND;
    default:
      return FinancialIntentAction.PARTIAL_REFUND;
  }
}

// ─── Harness wiring (real services over the fakes) ───────────────────────────────

import { DisputeCreationService } from '../service/dispute-creation.service';
import { DisputeEvidenceService } from '../service/dispute-evidence.service';
import { DisputeLifecycleService } from '../service/dispute-lifecycle.service';
import { DisputeResolutionService } from '../service/dispute-resolution.service';
import { DisputeSlaService } from '../service/dispute-sla.service';
import { DisputeViewService } from '../service/dispute-view.service';
import { EscrowIntentWorker } from '../jobs/escrow-intent.worker';
import { FinancialIntentWorker } from '../jobs/financial-intent.worker';
import { EvidenceRetentionProcessor } from '../jobs/evidence-retention.processor';
import { StaleGrantCleanupProcessor } from '../jobs/stale-grant-cleanup.processor';
import { TombstoneDrainProcessor } from '../jobs/tombstone-drain.processor';
import { DisputeRepository } from '../repository/dispute.repository';
import { DisputeEscrowIntentRepository } from '../repository/dispute-escrow-intent.repository';
import { DisputeFinancialIntentRepository } from '../repository/dispute-financial-intent.repository';
import { DisputeEvidenceRepository } from '../repository/dispute-evidence.repository';
import { DisputeUploadGrantRepository } from '../repository/dispute-upload-grant.repository';
import { DisputeObjectDeletionRepository } from '../repository/dispute-object-deletion.repository';
import { DisputeParticipationService } from '../service/dispute-participation.service';
import { EscrowClient } from '../escrow/escrow.client';
import { UpstreamEvidenceReader } from '../evidence/upstream-evidence.reader';
import { DisputeEvidenceStorageService } from '../storage/dispute-evidence-storage.service';

/** The assembled harness exposing the real services + the underlying fakes for assertions. */
export interface Harness {
  store: FakeStore;
  escrow: FakeEscrowClient;
  storage: FakeStorageService;
  disputeRepo: FakeDisputeRepository;
  escrowIntentRepo: FakeEscrowIntentRepository;
  financialIntentRepo: FakeFinancialIntentRepository;
  evidenceRepo: FakeEvidenceRepository;
  grantRepo: FakeGrantRepository;
  creation: DisputeCreationService;
  lifecycle: DisputeLifecycleService;
  resolution: DisputeResolutionService;
  sla: DisputeSlaService;
  evidence: DisputeEvidenceService;
  view: DisputeViewService;
  escrowWorker: EscrowIntentWorker;
  financialWorker: FinancialIntentWorker;
  retention: EvidenceRetentionProcessor;
  tombstoneDrain: TombstoneDrainProcessor;
  staleGrant: StaleGrantCleanupProcessor;
}

/** Build a fully-wired harness (real services, fake repos/seams). Resolvers is a set of user ids. */
export function buildHarness(resolvers: ReadonlySet<string> = new Set()): Harness {
  const store = new FakeStore();
  const escrow = new FakeEscrowClient(store);
  const storage = new FakeStorageService();
  const disputeRepo = new FakeDisputeRepository(store);
  const escrowIntentRepo = new FakeEscrowIntentRepository(store);
  const financialIntentRepo = new FakeFinancialIntentRepository(store);
  const evidenceRepo = new FakeEvidenceRepository(store);
  const grantRepo = new FakeGrantRepository(store);
  const objectDeletionRepo = new FakeObjectDeletionRepository(store);
  const participation = new FakeParticipationService(resolvers);
  const upstream = new FakeUpstreamEvidenceReader();

  const asDisputeRepo = disputeRepo as unknown as DisputeRepository;
  const asEscrowIntentRepo = escrowIntentRepo as unknown as DisputeEscrowIntentRepository;
  const asFinancialIntentRepo = financialIntentRepo as unknown as DisputeFinancialIntentRepository;
  const asEvidenceRepo = evidenceRepo as unknown as DisputeEvidenceRepository;
  const asGrantRepo = grantRepo as unknown as DisputeUploadGrantRepository;
  const asObjectDeletionRepo = objectDeletionRepo as unknown as DisputeObjectDeletionRepository;
  const asParticipation = participation as unknown as DisputeParticipationService;
  const asEscrow = escrow as unknown as EscrowClient;
  const asStorage = storage as unknown as DisputeEvidenceStorageService;
  const asUpstream = upstream as unknown as UpstreamEvidenceReader;

  const creation = new DisputeCreationService(asDisputeRepo, asEscrow);
  const resolution = new DisputeResolutionService(asDisputeRepo);
  const lifecycle = new DisputeLifecycleService(asDisputeRepo, asParticipation, resolution);
  const sla = new DisputeSlaService(asDisputeRepo);
  const evidence = new DisputeEvidenceService(
    asDisputeRepo,
    asEvidenceRepo,
    asGrantRepo,
    asStorage,
    asParticipation,
    asUpstream,
  );
  const view = new DisputeViewService(asDisputeRepo, asParticipation, evidence);
  const escrowWorker = new EscrowIntentWorker(asEscrowIntentRepo, asEscrow);
  const financialWorker = new FinancialIntentWorker(asFinancialIntentRepo, asDisputeRepo, asEscrow);
  const retention = new EvidenceRetentionProcessor(asEvidenceRepo, asStorage);
  const tombstoneDrain = new TombstoneDrainProcessor(asObjectDeletionRepo, asStorage);
  const staleGrant = new StaleGrantCleanupProcessor(asGrantRepo, asStorage);

  return {
    store,
    escrow,
    storage,
    disputeRepo,
    escrowIntentRepo,
    financialIntentRepo,
    evidenceRepo,
    grantRepo,
    creation,
    lifecycle,
    resolution,
    sla,
    evidence,
    view,
    escrowWorker,
    financialWorker,
    retention,
    tombstoneDrain,
    staleGrant,
  };
}
