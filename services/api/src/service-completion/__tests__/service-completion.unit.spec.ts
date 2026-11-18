import { BadRequestException, ConflictException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';

import { buildHarness, Harness } from './harness';
import { ReleaseIntentWorker } from '../jobs/release-intent.worker';
import { AutoReleaseSweepProcessor } from '../jobs/auto-release-sweep.processor';
import {
  CompletionCreatedConsumer,
  toChecklistCompletedPayload,
} from '../consumers/completion-created.consumer';
import {
  CompletionOutboxEventType,
  CompletionReleaseReason,
  CompletionState,
  IntentStatus,
  ReleaseStatus,
} from '../completion.types';

jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

const HOST = 'host-1';
const CLEANER = 'cleaner-1';
const OFFER = 'offer-1';
const PAYMENT = 'payment-1';
const SESSION = 'sess-1';
const WINDOW_MS = 86_400_000;

function seed(h: Harness): void {
  h.store.setSession(SESSION, { offerId: OFFER, paymentId: PAYMENT, hostId: HOST, cleanerId: CLEANER });
}

async function create(h: Harness, completedAt = new Date().toISOString()): Promise<string> {
  await h.creation.createFromChecklistCompleted({
    runId: 'run-1',
    serviceSessionId: SESSION,
    totalTasks: 1,
    completedTasks: 1,
    photoCount: 0,
    completedAt,
  });
  return (await h.repo.findBySessionId(SESSION))!.id;
}

describe('CompletionCreationService', () => {
  it('snapshots the deadline from completedAt (not consume time) and is idempotent', async () => {
    const h = buildHarness();
    seed(h);
    const completedAt = new Date(1_700_000_000_000).toISOString();
    const id = await create(h, completedAt);
    await create(h, completedAt); // redelivery
    expect([...h.store.completions.values()]).toHaveLength(1);
    const completion = h.store.completions.get(id)!;
    expect(completion.autoReleaseDeadline.getTime()).toBe(new Date(completedAt).getTime() + WINDOW_MS);
    expect(completion.paymentId).toBe(PAYMENT);
    expect(completion.hostId).toBe(HOST);
    expect(completion.cleanerId).toBe(CLEANER);
  });

  it('rejects a missing completedAt', async () => {
    const h = buildHarness();
    seed(h);
    await expect(
      h.creation.createFromChecklistCompleted({
        runId: 'run-1',
        serviceSessionId: SESSION,
        totalTasks: 1,
        completedTasks: 1,
        photoCount: 0,
        completedAt: '',
      }),
    ).rejects.toBeInstanceOf(Error);
    expect(h.store.completions.size).toBe(0);
  });

  it('rejects when no escrow payment resolves for the offer', async () => {
    const h = buildHarness();
    // no seeded session → no offer/payment
    await expect(
      h.creation.createFromChecklistCompleted({
        runId: 'run-1',
        serviceSessionId: SESSION,
        totalTasks: 1,
        completedTasks: 1,
        photoCount: 0,
        completedAt: new Date().toISOString(),
      }),
    ).rejects.toBeInstanceOf(Error);
  });
});

describe('CompletionParticipationService', () => {
  it('resolves host/cleaner and treats a nulled participant as a non-participant', () => {
    const h = buildHarness();
    const row = {
      id: 'c', service_session_id: SESSION, offer_id: OFFER, payment_id: PAYMENT,
      host_id: null, cleaner_id: CLEANER, state: CompletionState.CONFIRMED,
      checklist_completed_at: new Date(), auto_release_deadline: new Date(),
      confirmed_at: null, released_trigger: null, dispute_id: null, post_release_dispute_id: null,
    };
    expect(h.participation.isHost(HOST, row)).toBe(false); // host nulled
    expect(h.participation.isCleaner(CLEANER, row)).toBe(true);
    expect(h.participation.isParticipant(HOST, row)).toBe(false);
  });
});

describe('CompletionDecisionService', () => {
  it('confirm is Host-only; a Cleaner is 403', async () => {
    const h = buildHarness();
    seed(h);
    const id = await create(h);
    await expect(h.decision.confirm(id, CLEANER)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('confirm co-persists one PENDING intent + service_confirmed and never calls Stripe', async () => {
    const h = buildHarness();
    seed(h);
    const id = await create(h);
    await h.decision.confirm(id, HOST);
    expect(h.store.intents.filter((i) => i.serviceCompletionId === id)).toHaveLength(1);
    expect(h.store.outbox.filter((o) => o.type === CompletionOutboxEventType.CONFIRMED)).toHaveLength(1);
    expect(h.escrow.calls).toHaveLength(0);
  });

  it('confirm on a DISPUTED completion is 409', async () => {
    const h = buildHarness();
    seed(h);
    const id = await create(h);
    await h.decision.openDispute(id, HOST);
    await expect(h.decision.confirm(id, HOST)).rejects.toBeInstanceOf(ConflictException);
  });

  it('openDispute persists no intent and suppresses auto-release', async () => {
    const h = buildHarness();
    seed(h);
    const id = await create(h);
    await h.decision.openDispute(id, HOST);
    expect(h.store.intents).toHaveLength(0);
    expect(h.store.outbox.filter((o) => o.type === CompletionOutboxEventType.DISPUTED)).toHaveLength(1);
  });

  it('confirm on an unknown completion is 404', async () => {
    const h = buildHarness();
    await expect(h.decision.confirm('nope', HOST)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('post-release-dispute is 409 until the intent is ACCEPTED, then succeeds', async () => {
    const h = buildHarness();
    seed(h);
    const id = await create(h);
    await h.decision.confirm(id, HOST);
    await expect(h.decision.openPostReleaseDispute(id, HOST)).rejects.toBeInstanceOf(ConflictException);
    const intent = h.store.intents.find((i) => i.serviceCompletionId === id)!;
    intent.status = IntentStatus.ACCEPTED;
    await h.decision.openPostReleaseDispute(id, HOST);
    expect(h.store.completions.get(id)!.postReleaseDisputeId).not.toBeNull();
    expect(h.store.completions.get(id)!.state).toBe(CompletionState.CONFIRMED); // preserved, no reversal
  });
});

describe('AutoReleaseService', () => {
  it('single-winner AUTO_RELEASED + one intent + service_confirmed; no-op on non-AWAITING', async () => {
    const h = buildHarness();
    seed(h);
    const id = await create(h);
    expect(await h.autoRelease.autoReleaseDue(id)).toBe(true);
    expect(h.store.completions.get(id)!.releasedTrigger).toBe(CompletionReleaseReason.AUTO_RELEASE);
    expect(h.store.intents.filter((i) => i.serviceCompletionId === id)).toHaveLength(1);
    // Second call is a no-op.
    expect(await h.autoRelease.autoReleaseDue(id)).toBe(false);
    expect(h.escrow.calls).toHaveLength(0);
  });

  it('never auto-releases a DISPUTED completion', async () => {
    const h = buildHarness();
    seed(h);
    const id = await create(h);
    await h.decision.openDispute(id, HOST);
    expect(await h.autoRelease.autoReleaseDue(id)).toBe(false);
    expect(h.store.intents).toHaveLength(0);
  });
});

describe('RatingService', () => {
  it('rejects out-of-range stars (400) and a rating on a non-released completion (409)', async () => {
    const h = buildHarness();
    seed(h);
    const id = await create(h);
    await expect(h.ratings.submitRating(id, HOST, { stars: 3 })).rejects.toBeInstanceOf(ConflictException);
    await h.decision.confirm(id, HOST);
    await expect(h.ratings.submitRating(id, HOST, { stars: 9 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('one per side; duplicate side is 409; never touches state/intents', async () => {
    const h = buildHarness();
    seed(h);
    const id = await create(h);
    await h.decision.confirm(id, HOST);
    const intentsBefore = h.store.intents.length;
    await h.ratings.submitRating(id, HOST, { stars: 5, comment: 'great' });
    await expect(h.ratings.submitRating(id, HOST, { stars: 4 })).rejects.toBeInstanceOf(ConflictException);
    // Cleaner side is still free.
    await h.ratings.submitRating(id, CLEANER, { stars: 4 });
    expect(h.store.ratings).toHaveLength(2);
    expect(h.store.intents.length).toBe(intentsBefore); // no new intent from rating
    expect(h.store.completions.get(id)!.state).toBe(CompletionState.CONFIRMED);
  });

  it('getRatings is participant-gated', async () => {
    const h = buildHarness();
    seed(h);
    const id = await create(h);
    await expect(h.ratings.getRatings(id, 'stranger')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.ratings.getRatings(id, CLEANER)).resolves.toBeDefined();
  });
});

describe('ReleaseIntentWorker', () => {
  it('drains PENDING → ACCEPTED via a single-winner claim; the only path calling Spec 9', async () => {
    const h = buildHarness();
    seed(h);
    const id = await create(h);
    await h.decision.confirm(id, HOST);
    const worker = new ReleaseIntentWorker(h.intents as never, h.escrow as never);
    await worker.drainOnce();
    const intent = h.store.intents.find((i) => i.serviceCompletionId === id)!;
    expect(intent.status).toBe(IntentStatus.ACCEPTED);
    expect(h.escrow.calls).toHaveLength(1);
    expect(h.escrow.calls[0]!.reason).toBe(CompletionReleaseReason.HOST_CONFIRMED);
  });

  it('marks FAILED_RETRYABLE on a transient failure (attempt++) then succeeds on retry', async () => {
    const h = buildHarness();
    seed(h);
    const id = await create(h);
    await h.decision.confirm(id, HOST);
    const worker = new ReleaseIntentWorker(h.intents as never, h.escrow as never);
    h.escrow.failNext = 1;
    await worker.drainOnce();
    const intent = h.store.intents.find((i) => i.serviceCompletionId === id)!;
    expect(intent.status).toBe(IntentStatus.FAILED_RETRYABLE);
    expect(intent.attempt).toBe(1);
    await worker.drainOnce();
    expect(intent.status).toBe(IntentStatus.ACCEPTED);
  });

  it('does not steal a live (unexpired-lease) dispatch', async () => {
    const h = buildHarness();
    seed(h);
    const id = await create(h);
    await h.decision.confirm(id, HOST);
    const intent = h.store.intents.find((i) => i.serviceCompletionId === id)!;
    await h.intents.claimForDispatch(intent.id, 60_000);
    expect(await h.intents.drainClaimable(10)).toHaveLength(0); // lease still live
  });
});

describe('AutoReleaseSweepProcessor', () => {
  it('selects only due AWAITING_CONFIRMATION completions and is idempotent', async () => {
    const h = buildHarness();
    seed(h);
    const id = await create(h, new Date(h.store.now() - 2 * WINDOW_MS).toISOString());
    const sweep = new AutoReleaseSweepProcessor(h.repo as never, h.autoRelease as never);
    await sweep.sweepOnce(new Date(h.store.now()));
    await sweep.sweepOnce(new Date(h.store.now())); // re-run safe
    expect(h.store.completions.get(id)!.state).toBe(CompletionState.AUTO_RELEASED);
    expect(h.store.intents.filter((i) => i.serviceCompletionId === id)).toHaveLength(1);
  });
});

describe('CompletionCreatedConsumer', () => {
  it('creates via its own checkpoint then acks; a bad row is not acked (re-drainable)', async () => {
    const h = buildHarness();
    seed(h);
    const acks = new Set<string>();
    const checkpoint = {
      drainUnacked: jest.fn(async () => [
        {
          eventId: 'checklist_completed:run-1',
          type: 'checklist_completed',
          aggregateId: 'run-1',
          payload: {
            runId: 'run-1',
            serviceSessionId: SESSION,
            totalTasks: 1,
            completedTasks: 1,
            photoCount: 0,
            completedAt: new Date().toISOString(),
          },
        },
      ]),
      ack: jest.fn(async (eventId: string) => {
        acks.add(eventId);
      }),
    };
    const consumer = new CompletionCreatedConsumer(checkpoint as never, h.creation);
    await consumer.drainOnce();
    expect([...h.store.completions.values()]).toHaveLength(1);
    expect(acks.has('checklist_completed:run-1')).toBe(true);
  });

  it('acks (skips) an unrelated event type without creating a completion', async () => {
    const h = buildHarness();
    seed(h);
    const acks = new Set<string>();
    const checkpoint = {
      drainUnacked: jest.fn(async () => [
        { eventId: 'other:x', type: 'something_else', aggregateId: 'x', payload: {} },
      ]),
      ack: jest.fn(async (eventId: string) => {
        acks.add(eventId);
      }),
    };
    const consumer = new CompletionCreatedConsumer(checkpoint as never, h.creation);
    await consumer.drainOnce();
    expect(h.store.completions.size).toBe(0);
    expect(acks.has('other:x')).toBe(true);
  });

  it('toChecklistCompletedPayload maps the raw event fields', () => {
    const mapped = toChecklistCompletedPayload({
      runId: 'r', serviceSessionId: 's', totalTasks: 2, completedTasks: 1, photoCount: 3,
      completedAt: '2024-01-01T00:00:00.000Z',
    });
    expect(mapped.serviceSessionId).toBe('s');
    expect(mapped.completedAt).toBe('2024-01-01T00:00:00.000Z');
  });
});

describe('CompletionViewService', () => {
  it('derives release_status and exposes no internal intent fields', async () => {
    const h = buildHarness();
    seed(h);
    const id = await create(h);
    let view = await h.view.getCompletion(id, HOST);
    expect(view.releaseStatus).toBe(ReleaseStatus.NOT_TRIGGERED);
    await h.decision.confirm(id, HOST);
    view = await h.view.getCompletion(id, HOST);
    expect(view.releaseStatus).toBe(ReleaseStatus.PENDING);
    const intent = h.store.intents.find((i) => i.serviceCompletionId === id)!;
    intent.status = IntentStatus.ACCEPTED;
    view = await h.view.getCompletion(id, HOST);
    expect(view.releaseStatus).toBe(ReleaseStatus.ACCEPTED);
    expect(Object.keys(view)).not.toContain('leaseUntil');
  });
});
