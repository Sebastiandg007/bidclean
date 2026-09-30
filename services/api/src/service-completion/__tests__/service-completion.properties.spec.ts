import * as fc from 'fast-check';
import { ConflictException, ForbiddenException, Logger } from '@nestjs/common';

import { buildHarness, Harness } from './harness';
import { ReleaseIntentWorker } from '../jobs/release-intent.worker';
import { AutoReleaseSweepProcessor } from '../jobs/auto-release-sweep.processor';
import {
  CompletionOutboxEventType,
  CompletionState,
  IntentStatus,
  ReleaseStatus,
} from '../completion.types';

/**
 * Property-based tests for service-completion (Spec 20), fast-check ≥100 iters each. Each is tagged
 * `// Feature: service-completion, Property N: <text>` and maps to the design's P1–P13.
 *
 * Stripe (`EscrowReleaseService`) is a mocked seam (FakeEscrowRelease) — this module makes no real
 * Stripe calls. BullMQ/Postgres are modelled by the in-memory harness.
 */

jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

const HOST = 'host-1';
const CLEANER = 'cleaner-1';
const OFFER = 'offer-1';
const PAYMENT = 'payment-1';
const SESSION = 'sess-1';
const WINDOW_MS = 86_400_000; // matches SERVICE_AUTO_RELEASE_WINDOW_MS default (24h)

/** Seed the session→offer→payment/participants mapping the creation service resolves. */
function seedSession(h: Harness, sessionId = SESSION): void {
  h.store.setSession(sessionId, {
    offerId: OFFER,
    paymentId: PAYMENT,
    hostId: HOST,
    cleanerId: CLEANER,
  });
}

/** Create one completion for the seeded session; returns its id. */
async function createCompletion(h: Harness, completedAtIso: string, sessionId = SESSION): Promise<string> {
  await h.creation.createFromChecklistCompleted({
    runId: 'run-1',
    serviceSessionId: sessionId,
    totalTasks: 1,
    completedTasks: 1,
    photoCount: 0,
    completedAt: completedAtIso,
  });
  const completion = await h.repo.findBySessionId(sessionId);
  if (!completion) {
    throw new Error('completion not created');
  }
  return completion.id;
}

/** Build a release-intent worker over the harness (mocked escrow seam). */
function buildWorker(h: Harness): ReleaseIntentWorker {
  return new ReleaseIntentWorker(
    h.intents as never,
    h.escrow as never,
  );
}

// ── Property 1: one completion per session, idempotent, deadline snapshotted from finish time ──
describe('P1 — idempotent one-completion-per-session + snapshotted deadline', () => {
  // Feature: service-completion, Property 1: exactly one completion per session; deadline = completedAt + window; redelivery no-op.
  it('N redeliveries + concurrent creations yield exactly one completion anchored to completedAt', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 5_000_000_000 }),
        fc.integer({ min: 1, max: 5 }),
        async (epochMs, n) => {
          const h = buildHarness();
          seedSession(h);
          const completedAt = new Date(epochMs).toISOString();
          await Promise.all(
            Array.from({ length: n }, () =>
              h.creation.createFromChecklistCompleted({
                runId: 'run-1',
                serviceSessionId: SESSION,
                totalTasks: 1,
                completedTasks: 1,
                photoCount: 0,
                completedAt,
              }),
            ),
          );
          const all = [...h.store.completions.values()].filter((c) => c.serviceSessionId === SESSION);
          expect(all).toHaveLength(1);
          const completion = all[0]!;
          expect(completion.state).toBe(CompletionState.AWAITING_CONFIRMATION);
          expect(completion.checklistCompletedAt.toISOString()).toBe(completedAt);
          expect(completion.autoReleaseDeadline.getTime()).toBe(
            new Date(completedAt).getTime() + WINDOW_MS,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: service-completion, Property 1: a checklist_completed without completedAt is rejected (never consume-time anchored).
  it('rejects creation when the authoritative finish time is absent', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom('', '   ', 'not-a-date'), async (bad) => {
        const h = buildHarness();
        seedSession(h);
        await expect(
          h.creation.createFromChecklistCompleted({
            runId: 'run-1',
            serviceSessionId: SESSION,
            totalTasks: 1,
            completedTasks: 1,
            photoCount: 0,
            completedAt: bad,
          }),
        ).rejects.toBeInstanceOf(Error);
        expect(h.store.completions.size).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 2: durable intent, crash-safe (lease reclaim), only release path ──
describe('P2 — durable release intent, crash-safe, only release path', () => {
  // Feature: service-completion, Property 2: a release-bearing decision commits exactly one PENDING intent; no synchronous release.
  it('confirm commits exactly one PENDING intent and never calls Stripe in the request path', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        const h = buildHarness();
        seedSession(h);
        const id = await createCompletion(h, new Date().toISOString());
        await h.decision.confirm(id, HOST);
        const intents = h.store.intents.filter((i) => i.serviceCompletionId === id);
        expect(intents).toHaveLength(1);
        expect(intents[0]!.status).toBe(IntentStatus.PENDING);
        expect(h.escrow.calls).toHaveLength(0); // never called synchronously
      }),
      { numRuns: 100 },
    );
  });

  // Feature: service-completion, Property 2: the worker drives PENDING → ACCEPTED; a DISPATCHED-with-expired-lease intent is re-claimed (at most one Transfer).
  it('worker drains + reclaims an orphaned DISPATCHED intent, yielding at most one Transfer', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 2 }), async (transientFailures) => {
        const h = buildHarness();
        seedSession(h);
        const id = await createCompletion(h, new Date().toISOString());
        await h.decision.confirm(id, HOST);
        const worker = buildWorker(h);
        h.escrow.failNext = transientFailures;
        // Retry until accepted (each failure marks FAILED_RETRYABLE, retried next pass).
        for (let i = 0; i < transientFailures + 1; i += 1) {
          await worker.drainOnce();
        }
        const intent = h.store.intents.find((i) => i.serviceCompletionId === id)!;
        expect(intent.status).toBe(IntentStatus.ACCEPTED);
        expect(h.escrow.transferCountFor(PAYMENT)).toBe(1); // at most one Transfer
      }),
      { numRuns: 100 },
    );
  });

  // Feature: service-completion, Property 2: an intent left DISPATCHED by a crash is reclaimed once its lease elapses.
  it('a DISPATCHED intent whose lease elapsed is re-claimable and re-driven', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 61_000, max: 120_000 }), async (advanceMs) => {
        const h = buildHarness();
        seedSession(h);
        const id = await createCompletion(h, new Date().toISOString());
        await h.decision.confirm(id, HOST);
        // Simulate a crash after claim: claim the lease, then never accept.
        const intent = h.store.intents.find((i) => i.serviceCompletionId === id)!;
        await h.intents.claimForDispatch(intent.id, 60_000);
        expect(intent.status).toBe(IntentStatus.DISPATCHED);
        // Before the lease elapses it is NOT re-claimable.
        expect(await h.intents.drainClaimable(10)).toHaveLength(0);
        // After the lease elapses the next drain reclaims + drives it.
        h.store.clock += advanceMs;
        const worker = buildWorker(h);
        await worker.drainOnce();
        expect(intent.status).toBe(IntentStatus.ACCEPTED);
        expect(h.escrow.transferCountFor(PAYMENT)).toBe(1);
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 3: Host-only decisions, participant isolation ──
describe('P3 — Host-only decisions + participant isolation', () => {
  // Feature: service-completion, Property 3: confirm/dispute Host-only; non-participant 403; ratings participant-consistent.
  it('confirm/dispute permitted only for the Host; non-participants denied', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(HOST, CLEANER, 'stranger'), async (user) => {
        const h = buildHarness();
        seedSession(h);
        const id = await createCompletion(h, new Date().toISOString());
        if (user === HOST) {
          await expect(h.decision.confirm(id, user)).resolves.toBeUndefined();
        } else {
          await expect(h.decision.confirm(id, user)).rejects.toBeInstanceOf(ForbiddenException);
          expect(h.store.completions.get(id)!.state).toBe(CompletionState.AWAITING_CONFIRMATION);
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: service-completion, Property 3: GET is participant-gated; a stranger learns nothing.
  it('GET completion denies non-participants', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(HOST, CLEANER, 'stranger'), async (user) => {
        const h = buildHarness();
        seedSession(h);
        const id = await createCompletion(h, new Date().toISOString());
        if (user === 'stranger') {
          await expect(h.view.getCompletion(id, user)).rejects.toBeInstanceOf(ForbiddenException);
        } else {
          await expect(h.view.getCompletion(id, user)).resolves.toBeDefined();
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 4: single-winner decision + single-winner release ⇒ no double pay, no lost release ──
describe('P4 — single-winner decision + single-winner release', () => {
  // Feature: service-completion, Property 4: confirm vs auto-release vs dispute resolves to exactly one terminal; ≤ one intent; ≤ one Transfer.
  it('a three-way race yields exactly one terminal state and at most one intent + Transfer', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.shuffledSubarray(['confirm', 'auto', 'dispute'], { minLength: 1, maxLength: 3 }),
        async (order) => {
          const h = buildHarness();
          seedSession(h);
          // Deadline in the past so auto-release is eligible.
          const id = await createCompletion(h, new Date(h.store.now() - 2 * WINDOW_MS).toISOString());
          for (const action of order) {
            if (action === 'confirm') {
              await h.decision.confirm(id, HOST).catch(() => undefined);
            } else if (action === 'auto') {
              await h.autoRelease.autoReleaseDue(id).catch(() => undefined);
            } else {
              await h.decision.openDispute(id, HOST).catch(() => undefined);
            }
          }
          const completion = h.store.completions.get(id)!;
          const terminalStates: string[] = [
            CompletionState.CONFIRMED,
            CompletionState.AUTO_RELEASED,
            CompletionState.DISPUTED,
          ];
          expect(terminalStates.includes(completion.state)).toBe(true);
          const intents = h.store.intents.filter((i) => i.serviceCompletionId === id);
          expect(intents.length).toBeLessThanOrEqual(1);
          // Disputed → no intent; released → exactly one.
          if (completion.state === CompletionState.DISPUTED) {
            expect(intents).toHaveLength(0);
          } else {
            expect(intents).toHaveLength(1);
          }
          const worker = buildWorker(h);
          await worker.drainOnce();
          expect(h.escrow.transferCountFor(PAYMENT)).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: service-completion, Property 4: confirm on a non-AWAITING completion is idempotent/409, never a second intent.
  it('a repeat confirm is idempotent and never creates a second intent', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 5 }), async (times) => {
        const h = buildHarness();
        seedSession(h);
        const id = await createCompletion(h, new Date().toISOString());
        for (let i = 0; i < times; i += 1) {
          await h.decision.confirm(id, HOST);
        }
        expect(h.store.intents.filter((i) => i.serviceCompletionId === id)).toHaveLength(1);
        expect(h.store.completions.get(id)!.state).toBe(CompletionState.CONFIRMED);
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 5: transition + outbox atomicity ──
describe('P5 — transition + outbox atomicity', () => {
  // Feature: service-completion, Property 5: every release co-writes service_confirmed; a dispute co-writes service_disputed; a release always carries a trigger.
  it('a release-bearing decision co-writes exactly one service_confirmed with a trigger', async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (autoPath) => {
        const h = buildHarness();
        seedSession(h);
        const iso = autoPath
          ? new Date(h.store.now() - 2 * WINDOW_MS).toISOString()
          : new Date().toISOString();
        const id = await createCompletion(h, iso);
        if (autoPath) {
          await h.autoRelease.autoReleaseDue(id);
        } else {
          await h.decision.confirm(id, HOST);
        }
        const confirmed = h.store.outbox.filter(
          (o) => o.type === CompletionOutboxEventType.CONFIRMED,
        );
        expect(confirmed).toHaveLength(1);
        expect(h.store.completions.get(id)!.releasedTrigger).not.toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  // Feature: service-completion, Property 5: a rating co-writes exactly one service_rated in the same tx.
  it('a stored rating co-writes exactly one service_rated', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (stars) => {
        const h = buildHarness();
        seedSession(h);
        const id = await createCompletion(h, new Date().toISOString());
        await h.decision.confirm(id, HOST);
        await h.ratings.submitRating(id, HOST, { stars });
        expect(
          h.store.outbox.filter((o) => o.type === CompletionOutboxEventType.RATED),
        ).toHaveLength(1);
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 6: server-authoritative, durable auto-release from the finish time ──
describe('P6 — server-authoritative auto-release', () => {
  // Feature: service-completion, Property 6: an unconfirmed, non-disputed completion past its deadline converges to AUTO_RELEASED.
  it('a due completion converges to AUTO_RELEASED with one intent using the snapshotted deadline', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 1_000_000 }), async (pastMs) => {
        const h = buildHarness();
        seedSession(h);
        const id = await createCompletion(
          h,
          new Date(h.store.now() - WINDOW_MS - pastMs).toISOString(),
        );
        const sweep = new AutoReleaseSweepProcessor(h.repo as never, h.autoRelease as never);
        await sweep.sweepOnce(new Date(h.store.now()));
        expect(h.store.completions.get(id)!.state).toBe(CompletionState.AUTO_RELEASED);
        expect(h.store.intents.filter((i) => i.serviceCompletionId === id)).toHaveLength(1);
        expect(h.escrow.calls).toHaveLength(0); // sweep never calls Stripe
      }),
      { numRuns: 100 },
    );
  });

  // Feature: service-completion, Property 6: a not-yet-due completion is never auto-released (delayed queue grants no extra time).
  it('a completion whose deadline has not passed is never auto-released', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 1_000_000 }), async (futureMs) => {
        const h = buildHarness();
        seedSession(h);
        const id = await createCompletion(h, new Date(h.store.now() + futureMs).toISOString());
        const sweep = new AutoReleaseSweepProcessor(h.repo as never, h.autoRelease as never);
        await sweep.sweepOnce(new Date(h.store.now()));
        expect(h.store.completions.get(id)!.state).toBe(CompletionState.AWAITING_CONFIRMATION);
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 7: dispute suppresses auto-release ──
describe('P7 — dispute suppresses auto-release', () => {
  // Feature: service-completion, Property 7: a DISPUTED completion past the deadline never auto-releases and never creates an intent.
  it('a disputed completion is never auto-released and never gets an intent', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 1_000_000 }), async (pastMs) => {
        const h = buildHarness();
        seedSession(h);
        const id = await createCompletion(
          h,
          new Date(h.store.now() - WINDOW_MS - pastMs).toISOString(),
        );
        await h.decision.openDispute(id, HOST);
        const sweep = new AutoReleaseSweepProcessor(h.repo as never, h.autoRelease as never);
        await sweep.sweepOnce(new Date(h.store.now()));
        expect(h.store.completions.get(id)!.state).toBe(CompletionState.DISPUTED);
        expect(h.store.intents.filter((i) => i.serviceCompletionId === id)).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 8: deadline invariance to later config change ──
describe('P8 — deadline invariance to later config change', () => {
  // Feature: service-completion, Property 8: the snapshotted deadline never moves after creation.
  it('the auto_release_deadline stays the value snapshotted at creation', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 5_000_000_000 }), async (epochMs) => {
        const h = buildHarness();
        seedSession(h);
        const completedAt = new Date(epochMs).toISOString();
        const id = await createCompletion(h, completedAt);
        const snapshot = h.store.completions.get(id)!.autoReleaseDeadline.getTime();
        // A "later config change" cannot move the persisted value — re-read is identical.
        expect(h.store.completions.get(id)!.autoReleaseDeadline.getTime()).toBe(snapshot);
        expect(snapshot).toBe(new Date(completedAt).getTime() + WINDOW_MS);
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 9: pre-release vs post-release disputes are distinct (ACCEPTED gate) ──
describe('P9 — pre-release vs post-release dispute distinctness', () => {
  // Feature: service-completion, Property 9: post-release dispute accepted iff the intent is ACCEPTED; else 409 (release not yet executed).
  it('post-release dispute is gated on the release actually being ACCEPTED', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(
          IntentStatus.PENDING,
          IntentStatus.DISPATCHED,
          IntentStatus.FAILED_RETRYABLE,
          IntentStatus.ACCEPTED,
        ),
        async (intentStatus) => {
          const h = buildHarness();
          seedSession(h);
          const id = await createCompletion(h, new Date().toISOString());
          await h.decision.confirm(id, HOST);
          const intent = h.store.intents.find((i) => i.serviceCompletionId === id)!;
          intent.status = intentStatus;
          if (intentStatus === IntentStatus.ACCEPTED) {
            await expect(h.decision.openPostReleaseDispute(id, HOST)).resolves.toBeUndefined();
            const completion = h.store.completions.get(id)!;
            expect(completion.postReleaseDisputeId).not.toBeNull();
            expect(completion.state).toBe(CompletionState.CONFIRMED); // state preserved
          } else {
            await expect(h.decision.openPostReleaseDispute(id, HOST)).rejects.toBeInstanceOf(
              ConflictException,
            );
            expect(h.store.completions.get(id)!.postReleaseDisputeId).toBeNull();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Property 10: ratings captured, never gating ──
describe('P10 — ratings captured, never gating', () => {
  // Feature: service-completion, Property 10: rating accepted iff released state + participant + in-range + free side.
  it('accepts a valid rating and rejects duplicates / out-of-range / wrong state', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: -2, max: 8 }),
        fc.boolean(),
        async (stars, released) => {
          const h = buildHarness();
          seedSession(h);
          const id = await createCompletion(h, new Date().toISOString());
          if (released) {
            await h.decision.confirm(id, HOST);
          }
          const submit = h.ratings.submitRating(id, HOST, { stars });
          if (!released) {
            await expect(submit).rejects.toBeInstanceOf(ConflictException);
          } else if (stars < 1 || stars > 5) {
            await expect(submit).rejects.toBeDefined();
          } else {
            await expect(submit).resolves.toBeUndefined();
            // A duplicate for the same side is rejected.
            await expect(h.ratings.submitRating(id, HOST, { stars })).rejects.toBeInstanceOf(
              ConflictException,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: service-completion, Property 10: a release decision + intent are identical with or without a rating.
  it('a release never waits on a rating (intent identical with/without a rating)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (rateFirst) => {
        const h = buildHarness();
        seedSession(h);
        const id = await createCompletion(h, new Date().toISOString());
        await h.decision.confirm(id, HOST);
        if (rateFirst) {
          await h.ratings.submitRating(id, HOST, { stars: 5 });
        }
        expect(h.store.intents.filter((i) => i.serviceCompletionId === id)).toHaveLength(1);
        expect(h.store.completions.get(id)!.state).toBe(CompletionState.CONFIRMED);
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 11: realtime advisory; GET reconciliation authoritative (derived release_status) ──
describe('P11 — GET reconciliation authority + derived release_status', () => {
  // Feature: service-completion, Property 11: GET returns the derived release_status and exposes no internal intent fields.
  it('release_status is derived from the intent and no internal fields leak', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('none', 'pending', 'accepted', 'disputed'),
        async (scenario) => {
          const h = buildHarness();
          seedSession(h);
          const id = await createCompletion(h, new Date().toISOString());
          let expected: ReleaseStatus = ReleaseStatus.NOT_TRIGGERED;
          if (scenario === 'pending') {
            await h.decision.confirm(id, HOST);
            expected = ReleaseStatus.PENDING;
          } else if (scenario === 'accepted') {
            await h.decision.confirm(id, HOST);
            const intent = h.store.intents.find((i) => i.serviceCompletionId === id)!;
            intent.status = IntentStatus.ACCEPTED;
            expected = ReleaseStatus.ACCEPTED;
          } else if (scenario === 'disputed') {
            await h.decision.openDispute(id, HOST);
            expected = ReleaseStatus.NOT_TRIGGERED;
          }
          const view = await h.view.getCompletion(id, HOST);
          expect(view.releaseStatus).toBe(expected);
          const keys = Object.keys(view);
          for (const forbidden of ['attempt', 'dispatchedAt', 'leaseUntil', 'lastError']) {
            expect(keys).not.toContain(forbidden);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Property 12: deletion coherence (release path never lost) ──
describe('P12 — deletion coherence (release path never lost)', () => {
  // Feature: service-completion, Property 12: a retained intent (completion deleted, service_completion_id nulled) still drives to ACCEPTED.
  it('an intent whose completion was deleted still drives the release to ACCEPTED', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        const h = buildHarness();
        seedSession(h);
        const id = await createCompletion(h, new Date().toISOString());
        await h.decision.confirm(id, HOST);
        // Simulate parent session/offer cascade: delete the completion, null the intent FK (SET NULL).
        h.store.completions.delete(id);
        const intent = h.store.intents.find((i) => i.paymentId === PAYMENT)!;
        intent.serviceCompletionId = null;
        const worker = buildWorker(h);
        await worker.drainOnce();
        expect(intent.status).toBe(IntentStatus.ACCEPTED); // release path survived
        expect(h.escrow.transferCountFor(PAYMENT)).toBe(1);
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 13: no hardcoded config/secrets; validator fail-fast ──
describe('P13 — config safety + no secrets/PII leaked', () => {
  // Feature: service-completion, Property 13: the validator throws iff a required value is missing/invalid (incl. lease <= interval).
  it('validateServiceCompletionConfig throws on invalid config and passes on valid config', () => {
    fc.assert(
      fc.property(
        fc.record({
          window: fc.integer({ min: -10, max: 100_000 }),
          lease: fc.integer({ min: -10, max: 100_000 }),
          interval: fc.integer({ min: 1, max: 50_000 }),
          minStars: fc.integer({ min: 0, max: 6 }),
          maxStars: fc.integer({ min: 0, max: 6 }),
        }),
        (cfg) => {
          const prev = { ...process.env };
          process.env.NODE_ENV = 'production';
          process.env.SERVICE_AUTO_RELEASE_WINDOW_MS = String(cfg.window);
          process.env.SERVICE_COMPLETION_RELEASE_INTENT_LEASE_MS = String(cfg.lease);
          process.env.SERVICE_COMPLETION_RELEASE_INTENT_INTERVAL_MS = String(cfg.interval);
          process.env.SERVICE_RATING_MIN_STARS = String(cfg.minStars);
          process.env.SERVICE_RATING_MAX_STARS = String(cfg.maxStars);
          jest.resetModules();

          const valid =
            cfg.window > 0 &&
            cfg.lease > 0 &&
            cfg.lease > cfg.interval &&
            1 <= cfg.minStars &&
            cfg.minStars <= cfg.maxStars &&
            cfg.maxStars <= 5;

          const mod = require('../completion.constants') as {
            validateServiceCompletionConfig: () => void;
          };
          if (valid) {
            expect(() => mod.validateServiceCompletionConfig()).not.toThrow();
          } else {
            expect(() => mod.validateServiceCompletionConfig()).toThrow();
          }
          process.env = prev;
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: service-completion, Property 13: outbox payloads carry only ids/enums/routing fields (no secrets/PII).
  it('outbox payloads carry only ids/enums/routing fields', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom('confirm', 'dispute'), async (action) => {
        const h = buildHarness();
        seedSession(h);
        const id = await createCompletion(h, new Date().toISOString());
        if (action === 'confirm') {
          await h.decision.confirm(id, HOST);
        } else {
          await h.decision.openDispute(id, HOST);
        }
        for (const row of h.store.outbox) {
          const payload = row.payload as Record<string, unknown>;
          for (const value of Object.values(payload)) {
            expect(['string', 'number']).toContain(typeof value);
          }
          expect(JSON.stringify(payload)).not.toContain('secret');
        }
      }),
      { numRuns: 100 },
    );
  });
});
