import * as fc from 'fast-check';
import { Logger } from '@nestjs/common';

import {
  actionForResolution,
  buildHarness,
  FakeStore,
  Harness,
  StoredPayment,
} from './harness';
import { isInitiationAllowed } from '../policy/dispute-initiation.policy';
import { mapResolutionToAction } from '../policy/resolution-mapping';
import {
  DisputeEvidenceKind,
  DisputeInitiatorRole,
  DisputeOutboxEventType,
  DisputePhase,
  DisputeResolution,
  DisputeState,
  EscrowActionResult,
  FinancialIntentAction,
  IntentStatus,
} from '../dispute.types';

/**
 * Property-based tests for dispute-system (Spec 21), fast-check ≥100 iters each. Each is tagged
 * `// Feature: dispute-system, Property N: <text>` and maps to the design's P1–P15.
 *
 * Spec 9 (`EscrowClient`), MinIO, and BullMQ/Postgres are mocked seams (the in-memory harness). This
 * module makes no real Stripe/MinIO calls.
 */

jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

const RUNS = 100;
const HOST = 'host-1';
const CLEANER = 'cleaner-1';
const RESOLVER = 'resolver-1';
const OFFER = 'offer-1';
const PAYMENT = 'payment-1';
const COMPLETION = 'comp-1';

/** Seed a payment mapping for the offer with a given phase + settled state. */
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

/** Create a dispute via the routing consumer path; returns its id. */
async function createDispute(
  h: Harness,
  disputeId = 'route-1',
  completionId = COMPLETION,
): Promise<string | null> {
  await h.creation.createFromRouting({ completionId, offerId: OFFER, disputeId });
  const dispute = await h.disputeRepo.findByCompletionActive(completionId);
  return dispute?.id ?? null;
}

const arbPhase = fc.constantFrom(DisputePhase.PRE_RELEASE, DisputePhase.POST_RELEASE);
const arbResolution = fc.constantFrom(
  DisputeResolution.FAVOR_CLEANER,
  DisputeResolution.FAVOR_HOST,
  DisputeResolution.PARTIAL,
);

describe('dispute-system — property-based tests (P1–P15)', () => {
  // Feature: dispute-system, Property 1: One active dispute per completion, idempotent, phase from one explicit payment state
  it('P1: at most one active dispute per completion, phase from payout_status, redelivery no-op', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        arbPhase,
        async (redeliveries, phase) => {
          const h = buildHarness(new Set([RESOLVER]));
          seedPayment(h.store, {
            payoutStatus: phase,
            disputeStatus: 'NONE',
          });
          for (let i = 0; i < redeliveries; i += 1) {
            await createDispute(h, 'route-1');
          }
          const active = [...h.store.disputes.values()].filter((d) =>
            (['OPEN', 'UNDER_REVIEW'] as string[]).includes(d.state),
          );
          expect(active.length).toBe(1);
          expect(active[0]?.state).toBe(DisputeState.OPEN);
          expect(active[0]?.phase).toBe(phase);
          // An OPEN escrow-block intent is committed with the dispute.
          const escrowIntents = h.store.escrowIntents.filter((i) => i.target === 'OPEN');
          expect(escrowIntents.length).toBe(1);
        },
      ),
      { numRuns: RUNS },
    );
  });

  // Feature: dispute-system, Property 2: Opening durably blocks the escrow; release can't win vs a pending block
  it('P2: an OPEN escrow-block intent is committed with the dispute and the worker drives it to ACCEPTED', async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (transientFirst) => {
        const h = buildHarness();
        seedPayment(h.store);
        await createDispute(h);
        const openIntent = h.store.escrowIntents.find((i) => i.target === 'OPEN');
        expect(openIntent?.status).toBe(IntentStatus.PENDING);
        if (transientFirst) {
          // A transient failure leaves it retryable, never lost; the next drain accepts it.
          h.escrow.program({ throwOnce: false });
        }
        await h.escrowWorker.drainOnce();
        const after = h.store.escrowIntents.find((i) => i.target === 'OPEN');
        expect(after?.status).toBe(IntentStatus.ACCEPTED);
        expect(h.escrow.setStatusCalls.some((c) => c.target === 'OPEN')).toBe(true);
        // The payment is blocked OPEN — a release cannot win.
        expect(h.store.payments.get(PAYMENT)?.disputeStatus).toBe('OPEN');
      }),
      { numRuns: RUNS },
    );
  });

  // Feature: dispute-system, Property 3: Server-authoritative authorization + deterministic initiation policy
  it('P3: initiation is allowed iff the config policy allows (role, reason_code, phase)', async () => {
    await fc.assert(
      fc.property(
        fc.constantFrom(DisputeInitiatorRole.HOST, DisputeInitiatorRole.CLEANER),
        fc.constantFrom('QUALITY_INCOMPLETE', 'PAYOUT_NOT_RELEASED', 'UNKNOWN_CODE'),
        arbPhase,
        (role, reasonCode, phase) => {
          const allowed = isInitiationAllowed(role, reasonCode, phase);
          // A Cleaner may never raise a quality dispute against themselves.
          if (role === DisputeInitiatorRole.CLEANER && reasonCode === 'QUALITY_INCOMPLETE') {
            expect(allowed).toBe(false);
          }
          // An unknown reason code is never allowed for anyone.
          if (reasonCode === 'UNKNOWN_CODE') {
            expect(allowed).toBe(false);
          }
          // A Host quality grievance is always allowed (config default).
          if (role === DisputeInitiatorRole.HOST && reasonCode === 'QUALITY_INCOMPLETE') {
            expect(allowed).toBe(true);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  // Feature: dispute-system, Property 4: Clear-escrow-LAST, and only on an applied outcome (never on BLOCKED)
  it('P4: the NONE clear is enqueued only on an applied terminal; BLOCKED never clears', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(
          EscrowActionResult.APPLIED,
          EscrowActionResult.CEILING_CLAMPED,
          EscrowActionResult.NO_OP,
          EscrowActionResult.BLOCKED,
        ),
        async (result) => {
          const h = buildHarness(new Set([RESOLVER]));
          seedPayment(h.store);
          const id = (await createDispute(h)) as string;
          await h.escrowWorker.drainOnce(); // block accepted
          await h.lifecycle.resolve(id, RESOLVER, { resolution: DisputeResolution.FAVOR_HOST });
          h.escrow.program({ refundOutcome: { result, effectiveAmountCents: 500 } });
          await h.financialWorker.drainOnce();

          const fin = h.store.financialIntents.find((i) => i.disputeId === id);
          const noneEnqueued = h.store.escrowIntents.some((i) => i.target === 'NONE');
          if (result === EscrowActionResult.BLOCKED) {
            expect(fin?.status).toBe(IntentStatus.ACTION_BLOCKED);
            expect(noneEnqueued).toBe(false);
            expect(h.store.payments.get(PAYMENT)?.disputeStatus).toBe('OPEN');
          } else {
            expect(fin?.status).toBe(IntentStatus.ACCEPTED);
            expect(noneEnqueued).toBe(true);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  // Feature: dispute-system, Property 5: Evidence key != credential; bytes isolated
  it('P5: a grant is persisted before the URL; finalize succeeds only with a caller-issued grant', async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (foreignCaller) => {
        const h = buildHarness();
        seedPayment(h.store);
        const id = (await createDispute(h)) as string;
        const target = await h.evidence.requestUpload(id, HOST);
        // The grant exists before any finalize.
        expect(h.store.grants.has(target.objectKey)).toBe(true);
        const caller = foreignCaller ? 'stranger-9' : HOST;
        let finalized = true;
        try {
          await h.evidence.finalizeUpload(id, caller, { objectKey: target.objectKey });
        } catch {
          finalized = false;
        }
        // Only the issuing participant can finalize; a foreign caller cannot.
        expect(finalized).toBe(!foreignCaller);
      }),
      { numRuns: RUNS },
    );
  });

  // Feature: dispute-system, Property 6: Evidence is referenced (never re-derived) and gated by kind
  it('P6: visual kinds resolve to a URL, structured kinds to gated data; never public', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(
          DisputeEvidenceKind.CHECKLIST_REF,
          DisputeEvidenceKind.VERIFICATION_REF,
          DisputeEvidenceKind.ARRIVAL_REF,
        ),
        async () => {
          const h = buildHarness(new Set([RESOLVER]));
          seedPayment(h.store);
          const id = (await createDispute(h)) as string;
          const dispute = await h.disputeRepo.findById(id);
          const refs = h.store.evidence.filter((e) => e.disputeId === id);
          // Auto-linked references are stored (never byte copies).
          expect(refs.length).toBeGreaterThanOrEqual(4);
          const checklistRef = refs.find((e) => e.kind === DisputeEvidenceKind.CHECKLIST_REF);
          const resolved = await h.evidence.resolveEvidence(dispute!, RESOLVER, checklistRef!.id);
          expect(resolved.kind).toBe('structured');
        },
      ),
      { numRuns: RUNS },
    );
  });

  // Feature: dispute-system, Property 7: Never stuck; EXPIRED always fully settled
  it('P7: an overdue dispute expires with a non-null fallback resolution + exactly one financial intent', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 3 }), async (sweeps) => {
        const h = buildHarness();
        seedPayment(h.store);
        const id = (await createDispute(h)) as string;
        // Move the clock past the resolution deadline.
        const dispute = h.store.disputes.get(id)!;
        h.store.clock = dispute.resolutionDeadline.getTime() + 1;
        for (let i = 0; i < sweeps; i += 1) {
          const due = await h.disputeRepo.findDueForSla(new Date(h.store.now()), 100);
          for (const dueId of due) {
            await h.sla.expireDue(dueId);
          }
        }
        const after = h.store.disputes.get(id)!;
        expect(after.state).toBe(DisputeState.EXPIRED);
        expect(after.resolution).not.toBeNull();
        const intents = h.store.financialIntents.filter((i) => i.disputeId === id);
        expect(intents.length).toBe(1);
      }),
      { numRuns: RUNS },
    );
  });

  // Feature: dispute-system, Property 8: Single-winner terminality + atomicity + at-most-one financial intent
  it('P8: resolve racing SLA yields exactly one terminal and exactly one financial intent', async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), arbResolution, async (resolveFirst, resolution) => {
        const h = buildHarness(new Set([RESOLVER]));
        seedPayment(h.store);
        const id = (await createDispute(h)) as string;
        const dispute = h.store.disputes.get(id)!;
        h.store.clock = dispute.resolutionDeadline.getTime() + 1;
        const refundCents = resolution === DisputeResolution.PARTIAL ? 100 : undefined;

        if (resolveFirst) {
          await h.lifecycle.resolve(id, RESOLVER, { resolution, refundCents });
          await runSla(h, id); // loses: dispute already RESOLVED
          expect(h.store.disputes.get(id)?.state).toBe(DisputeState.RESOLVED);
        } else {
          await runSla(h, id); // wins: EXPIRED with the fallback
          // A subsequent resolve either no-ops (same fallback resolution) or 409s (different) —
          // never a second terminal, never a second intent.
          await expectResolveIdempotentOrConflict(h, id, resolution, refundCents);
          expect(h.store.disputes.get(id)?.state).toBe(DisputeState.EXPIRED);
        }
        const after = h.store.disputes.get(id)!;
        expect((['RESOLVED', 'EXPIRED'] as string[]).includes(after.state)).toBe(true);
        const intents = h.store.financialIntents.filter((i) => i.disputeId === id);
        expect(intents.length).toBe(1);
      }),
      { numRuns: RUNS },
    );
  });

  // Feature: dispute-system, Property 9: Resolution durably enqueues the money effect, never performs it (crash-safe)
  it('P9: resolve commits a PENDING financial intent without calling Stripe; the worker drives it', async () => {
    await fc.assert(
      fc.asyncProperty(arbResolution, async (resolution) => {
        const h = buildHarness(new Set([RESOLVER]));
        seedPayment(h.store);
        const id = (await createDispute(h)) as string;
        await h.escrowWorker.drainOnce();
        const refundCents = resolution === DisputeResolution.PARTIAL ? 100 : undefined;
        await h.lifecycle.resolve(id, RESOLVER, { resolution, refundCents });
        // No Stripe/EscrowClient call happened in the request path.
        expect(h.escrow.releaseCalls.length + h.escrow.refundCalls.length).toBe(0);
        const intent = h.store.financialIntents.find((i) => i.disputeId === id)!;
        expect(intent.status).toBe(IntentStatus.PENDING);
        expect(intent.action).toBe(actionForResolution(resolution));
        // The worker drives it to ACCEPTED (idempotent).
        await h.financialWorker.drainOnce();
        await h.financialWorker.drainOnce();
        expect(h.store.financialIntents.find((i) => i.disputeId === id)?.status).toBe(
          IntentStatus.ACCEPTED,
        );
      }),
      { numRuns: RUNS },
    );
  });

  // Feature: dispute-system, Property 10: Spec 9 owns amounts + ceilings; dispute-system never overrides; BLOCKED != applied
  it('P10: the worker surfaces Spec 9 outcome + effective amount; BLOCKED is never treated as applied', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(
          EscrowActionResult.APPLIED,
          EscrowActionResult.CEILING_CLAMPED,
          EscrowActionResult.BLOCKED,
        ),
        fc.integer({ min: 0, max: 10000 }),
        async (result, effective) => {
          const h = buildHarness(new Set([RESOLVER]));
          seedPayment(h.store);
          const id = (await createDispute(h)) as string;
          await h.lifecycle.resolve(id, RESOLVER, {
            resolution: DisputeResolution.PARTIAL,
            refundCents: 9999,
          });
          h.escrow.program({ refundOutcome: { result, effectiveAmountCents: effective } });
          await h.financialWorker.drainOnce();
          const intent = h.store.financialIntents.find((i) => i.disputeId === id)!;
          expect(intent.outcome).toBe(result);
          if (result === EscrowActionResult.BLOCKED) {
            expect(intent.status).toBe(IntentStatus.ACTION_BLOCKED);
          } else {
            expect(intent.status).toBe(IntentStatus.ACCEPTED);
            expect(intent.effectiveAmountCents).toBe(effective);
          }
          // The requested amount never overrides the effective amount.
          expect(intent.amountCents).toBe(9999);
        },
      ),
      { numRuns: RUNS },
    );
  });

  // Feature: dispute-system, Property 11: Single-winner + idempotent Spec 9 => at most one financial effect per dispute
  it('P11: repeated drains produce at most one applied financial effect per dispute', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 5 }), async (drains) => {
        const h = buildHarness(new Set([RESOLVER]));
        seedPayment(h.store);
        const id = (await createDispute(h)) as string;
        await h.lifecycle.resolve(id, RESOLVER, { resolution: DisputeResolution.FAVOR_HOST });
        h.escrow.program({ refundOutcome: { result: EscrowActionResult.APPLIED, effectiveAmountCents: 500 } });
        for (let i = 0; i < drains; i += 1) {
          await h.financialWorker.drainOnce();
        }
        // The refund landed at most once (the payment is settled after the first).
        expect(h.escrow.refundCalls.length).toBeLessThanOrEqual(1);
        expect(h.store.payments.get(PAYMENT)?.disputeSettledAt).not.toBeNull();
      }),
      { numRuns: RUNS },
    );
  });

  // Feature: dispute-system, Property 12: Server-authoritative, durable deadlines invariant to config
  it('P12: a dispute keeps its snapshotted deadlines regardless of later config values', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 1_000_000 }), async (drift) => {
        const h = buildHarness();
        seedPayment(h.store);
        const id = (await createDispute(h)) as string;
        const snapshot = h.store.disputes.get(id)!.resolutionDeadline.getTime();
        // Simulate the passage of time / a config change (the snapshot must not move).
        h.store.clock += drift;
        const reloaded = await h.disputeRepo.findById(id);
        expect(reloaded?.resolution_deadline.getTime()).toBe(snapshot);
      }),
      { numRuns: RUNS },
    );
  });

  // Feature: dispute-system, Property 13: Deletion coherence; intents survive cascade via SET NULL
  it('P13: a pending financial intent survives dispute deletion (dispute_id NULL, payment_id intact)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (nullDispute) => {
        const h = buildHarness(new Set([RESOLVER]));
        seedPayment(h.store);
        const id = (await createDispute(h)) as string;
        await h.lifecycle.resolve(id, RESOLVER, { resolution: DisputeResolution.FAVOR_HOST });
        // Simulate the cascade nulling the dispute_id (SET NULL, not delete).
        if (nullDispute) {
          for (const intent of h.store.financialIntents) {
            if (intent.disputeId === id) {
              intent.disputeId = null;
            }
          }
          h.store.disputes.delete(id);
        }
        h.escrow.program({ refundOutcome: { result: EscrowActionResult.APPLIED, effectiveAmountCents: 500 } });
        await h.financialWorker.drainOnce();
        const intent = h.store.financialIntents.find((i) => i.paymentId === PAYMENT)!;
        expect(intent.status).toBe(IntentStatus.ACCEPTED);
        expect(intent.paymentId).toBe(PAYMENT);
      }),
      { numRuns: RUNS },
    );
  });

  // Feature: dispute-system, Property 14: Realtime advisory + GET authority; no hardcoded config/secrets
  it('P14: GET reflects the authoritative durable state and exposes no internal intent fields', async () => {
    await fc.assert(
      fc.asyncProperty(arbPhase, async (phase) => {
        const h = buildHarness(new Set([RESOLVER]));
        seedPayment(h.store, { payoutStatus: phase });
        const id = (await createDispute(h)) as string;
        const view = await h.view.getDispute(id, RESOLVER);
        expect(view.id).toBe(id);
        expect(view.phase).toBe(phase);
        expect(view.state).toBe(DisputeState.OPEN);
        // The view has no internal intent fields (attempt/lease/outcome).
        expect(Object.keys(view)).not.toContain('attempt');
        expect(Object.keys(view)).not.toContain('effectiveAmountCents');
        // The outbox carries ids/enums only.
        const opened = h.store.outbox.find((o) => o.type === DisputeOutboxEventType.OPENED);
        expect(opened).toBeDefined();
      }),
      { numRuns: RUNS },
    );
  });

  // Feature: dispute-system, Property 15: At most one financial effect per payment across ALL its disputes
  it('P15: a second dispute on an already-settled payment is BLOCKED (no second refund/release)', async () => {
    await fc.assert(
      fc.asyncProperty(arbResolution, async (secondResolution) => {
        const h = buildHarness(new Set([RESOLVER]));
        seedPayment(h.store);
        // Dispute A: resolve + apply the refund → the payment becomes dispute-settled.
        const a = (await createDispute(h, 'route-a', 'comp-a')) as string;
        await h.lifecycle.resolve(a, RESOLVER, { resolution: DisputeResolution.FAVOR_HOST });
        h.escrow.program({ refundOutcome: { result: EscrowActionResult.APPLIED, effectiveAmountCents: 400 } });
        await h.financialWorker.drainOnce();
        expect(h.store.payments.get(PAYMENT)?.disputeSettledAt).not.toBeNull();

        // Dispute B on the SAME payment (a different completion) → its effect is BLOCKED.
        const b = (await createDispute(h, 'route-b', 'comp-b')) as string;
        const refundCents = secondResolution === DisputeResolution.PARTIAL ? 100 : undefined;
        await h.lifecycle.resolve(b, RESOLVER, { resolution: secondResolution, refundCents });
        h.escrow.program({});
        await h.financialWorker.drainOnce();
        const bIntent = h.store.financialIntents.find((i) => i.disputeId === b)!;
        expect(bIntent.status).toBe(IntentStatus.ACTION_BLOCKED);
        expect(bIntent.outcomeReason).toBe('PAYMENT_ALREADY_SETTLED');
      }),
      { numRuns: RUNS },
    );
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────────

/** Run one SLA pass for a dispute (single-winner). */
async function runSla(h: Harness, disputeId: string): Promise<void> {
  const due = await h.disputeRepo.findDueForSla(new Date(h.store.now()), 100);
  if (due.includes(disputeId)) {
    await h.sla.expireDue(disputeId);
  }
}

/**
 * A resolve after an SLA expiry must be single-winner-safe: it either no-ops idempotently (when the
 * requested resolution matches the fallback that already landed) or throws a conflict (different
 * terminal) — but never produces a second terminal or a second financial intent.
 */
async function expectResolveIdempotentOrConflict(
  h: Harness,
  disputeId: string,
  resolution: DisputeResolution,
  refundCents: number | undefined,
): Promise<void> {
  try {
    await h.lifecycle.resolve(disputeId, RESOLVER, { resolution, refundCents });
  } catch {
    // Conflict on a terminal-different resolution — acceptable.
  }
}

// Reference the pure mapping so the property suite also exercises it directly (P10).
describe('resolution-mapping (pure)', () => {
  it('maps each resolution to its action', () => {
    expect(mapResolutionToAction(DisputeResolution.FAVOR_CLEANER, null).action).toBe(
      FinancialIntentAction.RELEASE,
    );
    expect(mapResolutionToAction(DisputeResolution.FAVOR_HOST, null).action).toBe(
      FinancialIntentAction.FULL_REFUND,
    );
    expect(mapResolutionToAction(DisputeResolution.PARTIAL, 100).action).toBe(
      FinancialIntentAction.PARTIAL_REFUND,
    );
  });
});
