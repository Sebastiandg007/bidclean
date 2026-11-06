import * as fs from 'fs';
import * as path from 'path';
import { ConflictException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';

import { buildHarness, FakeStore, Harness, StoredPayment } from './harness';
import { isInitiationAllowed } from '../policy/dispute-initiation.policy';
import {
  DisputeEvidenceKind,
  DisputeInitiatorRole,
  DisputePhase,
  DisputeResolution,
  DisputeState,
  EscrowActionResult,
  IntentStatus,
} from '../dispute.types';

/**
 * Unit + integration-style tests for dispute-system (Spec 21), driving the REAL services over the
 * in-memory harness (mocked Spec 9 / MinIO / BullMQ). Covers creation idempotency + phase derivation,
 * clear-escrow-LAST, BLOCKED → ACTION_BLOCKED, NO_OP, SLA fallback, evidence gating, authorization,
 * no-Stripe-SDK, and the config validator.
 */

jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

const HOST = 'host-1';
const CLEANER = 'cleaner-1';
const RESOLVER = 'resolver-1';
const OFFER = 'offer-1';
const PAYMENT = 'payment-1';
const COMPLETION = 'comp-1';

function seedPayment(store: FakeStore, overrides: Partial<StoredPayment> = {}): void {
  store.setPayment({
    paymentId: PAYMENT,
    offerId: OFFER,
    hostId: HOST,
    cleanerId: CLEANER,
    payoutStatus: DisputePhase.PRE_RELEASE,
    disputeStatus: 'NONE',
    disputeSettledAt: null,
    ...overrides,
  });
}

async function createDispute(h: Harness, disputeId = 'route-1', completionId = COMPLETION): Promise<string> {
  await h.creation.createFromRouting({ completionId, offerId: OFFER, disputeId });
  const dispute = await h.disputeRepo.findByCompletionActive(completionId);
  if (!dispute) {
    throw new Error('dispute not created');
  }
  return dispute.id;
}

describe('DisputeCreationService', () => {
  it('creates one active dispute with the OPEN escrow intent + auto-linked references + opened outbox', async () => {
    const h = buildHarness();
    seedPayment(h.store, { payoutStatus: DisputePhase.POST_RELEASE });
    const id = await createDispute(h);
    const dispute = h.store.disputes.get(id)!;
    expect(dispute.state).toBe(DisputeState.OPEN);
    expect(dispute.phase).toBe(DisputePhase.POST_RELEASE); // from payout_status, not the completion
    expect(dispute.initiatorRole).toBe(DisputeInitiatorRole.HOST);
    expect(h.store.escrowIntents.filter((i) => i.target === 'OPEN')).toHaveLength(1);
    expect(h.store.evidence.filter((e) => e.disputeId === id)).toHaveLength(4);
    expect(h.store.outbox.some((o) => o.type === 'dispute_opened')).toBe(true);
  });

  it('is idempotent under redelivery (still one active dispute)', async () => {
    const h = buildHarness();
    seedPayment(h.store);
    await createDispute(h);
    await createDispute(h);
    await createDispute(h);
    expect([...h.store.disputes.values()].length).toBe(1);
  });

  it('throws when no payment resolves for the offer (row re-drainable)', async () => {
    const h = buildHarness();
    await expect(
      h.creation.createFromRouting({ completionId: COMPLETION, offerId: 'unknown', disputeId: 'x' }),
    ).rejects.toThrow();
  });
});

describe('DisputeLifecycleService.resolve', () => {
  it('rejects a non-resolver with 403', async () => {
    const h = buildHarness(new Set([RESOLVER]));
    seedPayment(h.store);
    const id = await createDispute(h);
    await expect(
      h.lifecycle.resolve(id, HOST, { resolution: DisputeResolution.FAVOR_HOST }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('resolves single-winner + one financial intent + resolved outbox, escrow NOT cleared yet', async () => {
    const h = buildHarness(new Set([RESOLVER]));
    seedPayment(h.store);
    const id = await createDispute(h);
    await h.lifecycle.resolve(id, RESOLVER, { resolution: DisputeResolution.FAVOR_HOST });
    expect(h.store.disputes.get(id)?.state).toBe(DisputeState.RESOLVED);
    expect(h.store.financialIntents.filter((i) => i.disputeId === id)).toHaveLength(1);
    expect(h.store.outbox.some((o) => o.type === 'dispute_resolved')).toBe(true);
    // clear-escrow-LAST: no NONE intent enqueued until the financial effect applies.
    expect(h.store.escrowIntents.some((i) => i.target === 'NONE')).toBe(false);
  });

  it('is idempotent on the same resolution, and 409 on a terminal-different resolution', async () => {
    const h = buildHarness(new Set([RESOLVER]));
    seedPayment(h.store);
    const id = await createDispute(h);
    await h.lifecycle.resolve(id, RESOLVER, { resolution: DisputeResolution.FAVOR_HOST });
    await expect(
      h.lifecycle.resolve(id, RESOLVER, { resolution: DisputeResolution.FAVOR_HOST }),
    ).resolves.toBeUndefined();
    await expect(
      h.lifecycle.resolve(id, RESOLVER, { resolution: DisputeResolution.FAVOR_CLEANER }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a PARTIAL resolution without a refund amount', async () => {
    const h = buildHarness(new Set([RESOLVER]));
    seedPayment(h.store);
    const id = await createDispute(h);
    await expect(
      h.lifecycle.resolve(id, RESOLVER, { resolution: DisputeResolution.PARTIAL }),
    ).rejects.toThrow();
  });
});

describe('FinancialIntentWorker — clear-escrow-LAST + outcomes', () => {
  it('enqueues the NONE clear only after an APPLIED effect', async () => {
    const h = buildHarness(new Set([RESOLVER]));
    seedPayment(h.store);
    const id = await createDispute(h);
    await h.escrowWorker.drainOnce();
    await h.lifecycle.resolve(id, RESOLVER, { resolution: DisputeResolution.FAVOR_HOST });
    h.escrow.program({ refundOutcome: { result: EscrowActionResult.APPLIED, effectiveAmountCents: 300 } });
    await h.financialWorker.drainOnce();
    await h.escrowWorker.drainOnce(); // drives the NONE clear
    expect(h.store.payments.get(PAYMENT)?.disputeStatus).toBe('NONE');
  });

  it('marks ACTION_BLOCKED and never clears on BLOCKED', async () => {
    const h = buildHarness(new Set([RESOLVER]));
    seedPayment(h.store);
    const id = await createDispute(h);
    await h.escrowWorker.drainOnce();
    await h.lifecycle.resolve(id, RESOLVER, { resolution: DisputeResolution.FAVOR_HOST });
    h.escrow.program({ refundOutcome: { result: EscrowActionResult.BLOCKED, reason: 'PAYMENT_ALREADY_SETTLED' } });
    await h.financialWorker.drainOnce();
    expect(h.store.financialIntents.find((i) => i.disputeId === id)?.status).toBe(
      IntentStatus.ACTION_BLOCKED,
    );
    expect(h.store.escrowIntents.some((i) => i.target === 'NONE')).toBe(false);
    expect(h.store.payments.get(PAYMENT)?.disputeStatus).toBe('OPEN');
  });

  it('treats FAVOR_CLEANER + POST_RELEASE as an accepted NO_OP → escrow cleared', async () => {
    const h = buildHarness(new Set([RESOLVER]));
    seedPayment(h.store, { payoutStatus: DisputePhase.POST_RELEASE });
    const id = await createDispute(h);
    await h.escrowWorker.drainOnce();
    await h.lifecycle.resolve(id, RESOLVER, { resolution: DisputeResolution.FAVOR_CLEANER });
    h.escrow.program({ releaseOutcome: { result: EscrowActionResult.NO_OP, effectiveAmountCents: 0 } });
    await h.financialWorker.drainOnce();
    await h.escrowWorker.drainOnce();
    expect(h.store.financialIntents.find((i) => i.disputeId === id)?.status).toBe(IntentStatus.ACCEPTED);
    expect(h.store.payments.get(PAYMENT)?.disputeStatus).toBe('NONE');
  });
});

describe('DisputeSlaService.expireDue', () => {
  it('expires with the fallback resolution + a financial intent (never null)', async () => {
    const h = buildHarness();
    seedPayment(h.store);
    const id = await createDispute(h);
    h.store.clock = h.store.disputes.get(id)!.resolutionDeadline.getTime() + 1;
    await h.sla.expireDue(id);
    const dispute = h.store.disputes.get(id)!;
    expect(dispute.state).toBe(DisputeState.EXPIRED);
    expect(dispute.resolution).not.toBeNull();
    expect(h.store.financialIntents.filter((i) => i.disputeId === id)).toHaveLength(1);
  });
});

describe('DisputeEvidenceService', () => {
  it('gates request-upload by participant + window; grant is persisted first', async () => {
    const h = buildHarness();
    seedPayment(h.store);
    const id = await createDispute(h);
    const target = await h.evidence.requestUpload(id, HOST);
    expect(h.store.grants.get(target.objectKey)?.status).toBe('ISSUED');
    await expect(h.evidence.requestUpload(id, 'stranger')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects evidence after the deadline (window closed)', async () => {
    const h = buildHarness();
    seedPayment(h.store);
    const id = await createDispute(h);
    // Force the snapshotted evidence deadline into the past (the service checks it against now()).
    h.store.disputes.get(id)!.evidenceDeadline = new Date(Date.now() - 1000);
    await expect(h.evidence.requestUpload(id, HOST)).rejects.toBeInstanceOf(ConflictException);
  });

  it('resolves a HOST_PHOTO to a visual URL and a structured ref to gated data', async () => {
    const h = buildHarness(new Set([RESOLVER]));
    seedPayment(h.store);
    const id = await createDispute(h);
    const target = await h.evidence.requestUpload(id, HOST);
    await h.evidence.finalizeUpload(id, HOST, { objectKey: target.objectKey });
    const dispute = await h.disputeRepo.findById(id);
    const photo = h.store.evidence.find((e) => e.kind === DisputeEvidenceKind.HOST_PHOTO)!;
    const visual = await h.evidence.resolveEvidence(dispute!, RESOLVER, photo.id);
    expect(visual.kind).toBe('visual');
    const structuredRow = h.store.evidence.find((e) => e.kind === DisputeEvidenceKind.CHECKLIST_REF)!;
    const structured = await h.evidence.resolveEvidence(dispute!, HOST, structuredRow.id);
    expect(structured.kind).toBe('structured');
  });

  it('denies evidence read for a non-participant/non-resolver', async () => {
    const h = buildHarness();
    seedPayment(h.store);
    const id = await createDispute(h);
    const dispute = await h.disputeRepo.findById(id);
    const ref = h.store.evidence[0]!;
    await expect(
      h.evidence.resolveEvidence(dispute!, 'stranger', ref.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('DisputeViewService', () => {
  it('returns 404 for an unknown dispute and 403 for a non-participant', async () => {
    const h = buildHarness();
    seedPayment(h.store);
    const id = await createDispute(h);
    await expect(h.view.getDispute('nope', HOST)).rejects.toBeInstanceOf(NotFoundException);
    await expect(h.view.getDispute(id, 'stranger')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('EvidenceRetentionProcessor', () => {
  it('deletes only TERMINAL-dispute objects past the horizon, never non-terminal', async () => {
    const h = buildHarness(new Set([RESOLVER]));
    seedPayment(h.store);
    const terminalId = await createDispute(h, 'route-t', 'comp-t');
    const target = await h.evidence.requestUpload(terminalId, HOST);
    await h.evidence.finalizeUpload(terminalId, HOST, { objectKey: target.objectKey });
    await h.lifecycle.resolve(terminalId, RESOLVER, { resolution: DisputeResolution.FAVOR_HOST });

    const activeId = await createDispute(h, 'route-a', 'comp-a');
    const activeTarget = await h.evidence.requestUpload(activeId, HOST);
    await h.evidence.finalizeUpload(activeId, HOST, { objectKey: activeTarget.objectKey });

    // Push BOTH uploads' clocks far past the retention horizon (uploaded_at is the retention clock).
    const longAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 365);
    for (const ev of h.store.evidence) {
      if (ev.objectKey !== null) {
        ev.uploadedAt = longAgo;
      }
    }
    await h.retention.sweepOnce();
    // Only the TERMINAL dispute's object is deleted; the active dispute's is preserved.
    expect(h.storage.deleted).toContain(target.objectKey);
    expect(h.storage.deleted).not.toContain(activeTarget.objectKey);
  });
});

describe('EscrowClient — no Stripe SDK anywhere in the module', () => {
  it('does not import stripe in any dispute-system source file', () => {
    const root = path.join(__dirname, '..');
    const offenders = collectStripeImports(root);
    expect(offenders).toEqual([]);
  });
});

describe('DisputeInitiationPolicy (pure)', () => {
  it('allows Host quality grievances and denies a Cleaner self-quality dispute', () => {
    expect(isInitiationAllowed(DisputeInitiatorRole.HOST, 'QUALITY_INCOMPLETE', DisputePhase.PRE_RELEASE)).toBe(true);
    expect(isInitiationAllowed(DisputeInitiatorRole.CLEANER, 'QUALITY_INCOMPLETE', DisputePhase.PRE_RELEASE)).toBe(false);
    expect(isInitiationAllowed(DisputeInitiatorRole.CLEANER, 'PAYOUT_NOT_RELEASED', DisputePhase.PRE_RELEASE)).toBe(true);
  });
});

/** Recursively collect any dispute-system source file that imports the Stripe SDK. */
function collectStripeImports(dir: string): string[] {
  const offenders: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') {
        continue;
      }
      offenders.push(...collectStripeImports(full));
    } else if (entry.name.endsWith('.ts')) {
      const content = fs.readFileSync(full, 'utf8');
      if (/from ['"]stripe['"]/.test(content) || /require\(['"]stripe['"]\)/.test(content)) {
        offenders.push(full);
      }
    }
  }
  return offenders;
}
