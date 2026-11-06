import { EntityManager } from 'typeorm';

import { OutboxRow } from '../../common/outbox/outbox-writer';
import { CompletionState, IntentStatus } from '../completion.types';
import {
  CompletionRepository,
  CompletionRow,
  CreateCompletionParams,
  ReleaseIntentSpec,
  TransitionDerivedFields,
} from '../repository/completion.repository';
import {
  InsertRatingParams,
  ServiceRatingRepository,
  ServiceRatingRow,
} from '../repository/service-rating.repository';
import {
  ReleaseIntentRepository,
  ReleaseIntentRow,
} from '../repository/release-intent.repository';
import { CompletionParticipationService } from '../service/completion-participation.service';
import { CompletionCreationService } from '../service/completion-creation.service';
import { CompletionDecisionService } from '../service/completion-decision.service';
import { AutoReleaseService } from '../service/auto-release.service';
import { RatingService } from '../service/rating.service';
import { CompletionViewService } from '../service/completion-view.service';

/**
 * In-memory test harness modelling the service-completion DB invariants (mirrors the checklist-photos
 * harness). It lets the real services run against deterministic state so property-based tests can
 * quantify over behaviour. Concurrency is simulated by serializing operations — the production
 * single-winner conditional writes enforce the same "exactly one wins" semantics this fake models
 * (a transition only succeeds from AWAITING_CONFIRMATION; a second attempt is a no-op).
 */

/** A stored completion (mutable). */
export interface StoredCompletion {
  id: string;
  serviceSessionId: string;
  offerId: string;
  paymentId: string;
  hostId: string | null;
  cleanerId: string | null;
  state: string;
  checklistCompletedAt: Date;
  autoReleaseDeadline: Date;
  confirmedAt: Date | null;
  releasedTrigger: string | null;
  disputeId: string | null;
  postReleaseDisputeId: string | null;
}

/** A stored release intent (mutable). */
export interface StoredIntent {
  id: string;
  serviceCompletionId: string | null;
  paymentId: string;
  reason: string;
  status: string;
  attempt: number;
  dispatchedAt: Date | null;
  leaseUntil: Date | null;
  lastError: string | null;
  createdAt: number;
}

/** A stored rating (mutable). */
export interface StoredRating {
  id: string;
  serviceCompletionId: string;
  role: string;
  stars: number;
  comment: string | null;
  createdAt: Date;
}

/** A stored session/offer/payment mapping for cross-module resolution. */
export interface StoredSession {
  offerId: string;
  paymentId: string;
  hostId: string;
  cleanerId: string;
}

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

/** The shared deterministic in-memory store. */
export class FakeStore {
  completions = new Map<string, StoredCompletion>();
  intents: StoredIntent[] = [];
  ratings: StoredRating[] = [];
  outbox: OutboxRow[] = [];
  sessions = new Map<string, StoredSession>();
  clock = Date.now();

  now(): number {
    return this.clock;
  }

  setSession(sessionId: string, session: StoredSession): void {
    this.sessions.set(sessionId, session);
  }
}

/** Fake CompletionRepository over the shared store (mirrors the real SQL semantics). */
export class FakeCompletionRepository {
  constructor(private readonly store: FakeStore) {}

  async createCompletion(params: CreateCompletionParams): Promise<boolean> {
    for (const existing of this.store.completions.values()) {
      if (existing.serviceSessionId === params.serviceSessionId) {
        return false; // UNIQUE service_session_id → ON CONFLICT DO NOTHING
      }
    }
    const id = nextId('comp');
    this.store.completions.set(id, {
      id,
      serviceSessionId: params.serviceSessionId,
      offerId: params.offerId,
      paymentId: params.paymentId,
      hostId: params.hostId,
      cleanerId: params.cleanerId,
      state: CompletionState.AWAITING_CONFIRMATION,
      checklistCompletedAt: params.checklistCompletedAt,
      autoReleaseDeadline: params.autoReleaseDeadline,
      confirmedAt: null,
      releasedTrigger: null,
      disputeId: null,
      postReleaseDisputeId: null,
    });
    return true;
  }

  async transition(
    id: string,
    next: CompletionState,
    derived: TransitionDerivedFields,
    intent: ReleaseIntentSpec | null,
    outbox: OutboxRow,
  ): Promise<boolean> {
    const completion = this.store.completions.get(id);
    if (!completion || completion.state !== CompletionState.AWAITING_CONFIRMATION) {
      return false; // single-winner: only from AWAITING_CONFIRMATION
    }
    completion.state = next;
    if (derived.confirmedAt === true) {
      completion.confirmedAt = completion.confirmedAt ?? new Date(this.store.now());
    }
    if (derived.releasedTrigger !== undefined) {
      completion.releasedTrigger = derived.releasedTrigger;
    }
    if (derived.disputeId !== undefined) {
      completion.disputeId = completion.disputeId ?? derived.disputeId;
    }
    if (intent) {
      this.insertIntent(id, intent.paymentId, intent.reason);
    }
    this.pushOutbox(outbox);
    return true;
  }

  async transitionPostReleaseDispute(
    id: string,
    disputeId: string,
    outbox: OutboxRow,
  ): Promise<boolean> {
    const completion = this.store.completions.get(id);
    if (!completion) {
      return false;
    }
    const inReleasedState =
      completion.state === CompletionState.CONFIRMED ||
      completion.state === CompletionState.AUTO_RELEASED;
    const hasAccepted = this.store.intents.some(
      (i) => i.serviceCompletionId === id && i.status === IntentStatus.ACCEPTED,
    );
    if (!inReleasedState || completion.postReleaseDisputeId !== null || !hasAccepted) {
      return false; // ACCEPTED gate
    }
    completion.postReleaseDisputeId = disputeId;
    this.pushOutbox(outbox);
    return true;
  }

  async findById(id: string): Promise<CompletionRow | null> {
    const completion = this.store.completions.get(id);
    return completion ? this.toRow(completion) : null;
  }

  async findBySessionId(sessionId: string): Promise<CompletionRow | null> {
    for (const completion of this.store.completions.values()) {
      if (completion.serviceSessionId === sessionId) {
        return this.toRow(completion);
      }
    }
    return null;
  }

  async findDueForAutoRelease(now: Date, limit: number): Promise<string[]> {
    return [...this.store.completions.values()]
      .filter(
        (c) =>
          c.state === CompletionState.AWAITING_CONFIRMATION &&
          c.autoReleaseDeadline.getTime() <= now.getTime(),
      )
      .sort((a, b) => a.autoReleaseDeadline.getTime() - b.autoReleaseDeadline.getTime())
      .slice(0, limit)
      .map((c) => c.id);
  }

  async resolveOfferIdForSession(sessionId: string): Promise<string | null> {
    return this.store.sessions.get(sessionId)?.offerId ?? null;
  }

  async resolvePaymentForOffer(
    offerId: string,
  ): Promise<{ paymentId: string; hostId: string; cleanerId: string } | null> {
    for (const session of this.store.sessions.values()) {
      if (session.offerId === offerId) {
        return {
          paymentId: session.paymentId,
          hostId: session.hostId,
          cleanerId: session.cleanerId,
        };
      }
    }
    return null;
  }

  async findRatedRoles(completionId: string): Promise<string[]> {
    return this.store.ratings
      .filter((r) => r.serviceCompletionId === completionId)
      .map((r) => r.role);
  }

  async withTransaction<T>(fn: (manager: EntityManager) => Promise<T>): Promise<T> {
    return fn({} as EntityManager);
  }

  private insertIntent(completionId: string, paymentId: string, reason: string): void {
    if (this.store.intents.some((i) => i.serviceCompletionId === completionId)) {
      return; // uq_release_intents_completion → ON CONFLICT DO NOTHING
    }
    this.store.intents.push({
      id: nextId('intent'),
      serviceCompletionId: completionId,
      paymentId,
      reason,
      status: IntentStatus.PENDING,
      attempt: 0,
      dispatchedAt: null,
      leaseUntil: null,
      lastError: null,
      createdAt: this.store.now(),
    });
  }

  private pushOutbox(outbox: OutboxRow): void {
    if (!this.store.outbox.some((row) => row.eventId === outbox.eventId)) {
      this.store.outbox.push(outbox);
    }
  }

  private toRow(completion: StoredCompletion): CompletionRow {
    return {
      id: completion.id,
      service_session_id: completion.serviceSessionId,
      offer_id: completion.offerId,
      payment_id: completion.paymentId,
      host_id: completion.hostId,
      cleaner_id: completion.cleanerId,
      state: completion.state,
      checklist_completed_at: completion.checklistCompletedAt,
      auto_release_deadline: completion.autoReleaseDeadline,
      confirmed_at: completion.confirmedAt,
      released_trigger: completion.releasedTrigger,
      dispute_id: completion.disputeId,
      post_release_dispute_id: completion.postReleaseDisputeId,
    };
  }
}

/** Fake ReleaseIntentRepository over the shared store (mirrors the lease-claim semantics). */
export class FakeReleaseIntentRepository {
  constructor(private readonly store: FakeStore) {}

  async drainClaimable(limit: number): Promise<ReleaseIntentRow[]> {
    const now = this.store.now();
    return this.store.intents
      .filter(
        (i) =>
          i.status === IntentStatus.PENDING ||
          i.status === IntentStatus.FAILED_RETRYABLE ||
          (i.status === IntentStatus.DISPATCHED &&
            i.leaseUntil !== null &&
            i.leaseUntil.getTime() <= now),
      )
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, limit)
      .map((i) => this.toRow(i));
  }

  async claimForDispatch(id: string, leaseMs: number): Promise<boolean> {
    const now = this.store.now();
    const intent = this.store.intents.find((i) => i.id === id);
    if (!intent) {
      return false;
    }
    const claimable =
      intent.status === IntentStatus.PENDING ||
      intent.status === IntentStatus.FAILED_RETRYABLE ||
      (intent.status === IntentStatus.DISPATCHED &&
        intent.leaseUntil !== null &&
        intent.leaseUntil.getTime() <= now);
    if (!claimable) {
      return false; // single-winner claim
    }
    intent.status = IntentStatus.DISPATCHED;
    intent.dispatchedAt = new Date(now);
    intent.leaseUntil = new Date(now + leaseMs);
    return true;
  }

  async markAccepted(id: string): Promise<void> {
    const intent = this.store.intents.find((i) => i.id === id);
    if (intent && intent.status !== IntentStatus.ACCEPTED) {
      intent.status = IntentStatus.ACCEPTED;
      intent.lastError = null;
    }
  }

  async markFailedRetryable(id: string, error: string): Promise<void> {
    const intent = this.store.intents.find((i) => i.id === id);
    if (intent && intent.status !== IntentStatus.ACCEPTED) {
      intent.status = IntentStatus.FAILED_RETRYABLE;
      intent.attempt += 1;
      intent.leaseUntil = null;
      intent.lastError = error.slice(0, 500);
    }
  }

  async findByCompletion(completionId: string): Promise<ReleaseIntentRow | null> {
    const intent = this.store.intents.find((i) => i.serviceCompletionId === completionId);
    return intent ? this.toRow(intent) : null;
  }

  private toRow(intent: StoredIntent): ReleaseIntentRow {
    return {
      id: intent.id,
      service_completion_id: intent.serviceCompletionId,
      payment_id: intent.paymentId,
      reason: intent.reason,
      status: intent.status,
      attempt: intent.attempt,
    };
  }
}

/** Fake ServiceRatingRepository over the shared store (mirrors one-per-side ON CONFLICT). */
export class FakeServiceRatingRepository {
  constructor(private readonly store: FakeStore) {}

  async insertOnePerSide(params: InsertRatingParams, outbox: OutboxRow): Promise<boolean> {
    const taken = this.store.ratings.some(
      (r) => r.serviceCompletionId === params.serviceCompletionId && r.role === params.role,
    );
    if (taken) {
      return false;
    }
    this.store.ratings.push({
      id: nextId('rating'),
      serviceCompletionId: params.serviceCompletionId,
      role: params.role,
      stars: params.stars,
      comment: params.comment,
      createdAt: new Date(this.store.now()),
    });
    if (!this.store.outbox.some((row) => row.eventId === outbox.eventId)) {
      this.store.outbox.push(outbox);
    }
    return true;
  }

  async findByCompletion(completionId: string): Promise<ServiceRatingRow[]> {
    return this.store.ratings
      .filter((r) => r.serviceCompletionId === completionId)
      .map((r) => ({
        id: r.id,
        service_completion_id: r.serviceCompletionId,
        role: r.role,
        stars: r.stars,
        comment: r.comment,
        created_at: r.createdAt,
      }));
  }
}

/** A fake EscrowReleaseService seam recording calls (mirrors Spec 9 single-winner idempotency). */
export class FakeEscrowRelease {
  calls: Array<{ paymentId: string; reason: string }> = [];
  failNext = 0;
  private readonly transfers = new Map<string, number>();

  async release(paymentId: string, reason: string): Promise<void> {
    this.calls.push({ paymentId, reason });
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error('transient release failure');
    }
    // Spec 9 single-winner: the FIRST successful release creates the one Transfer; a repeat is a
    // no-op (at most one Transfer per payment), so the count never exceeds one.
    if (!this.transfers.has(paymentId)) {
      this.transfers.set(paymentId, 1);
    }
  }

  /** The number of real Transfers for a payment (0 or 1 — Spec 9 single-winner). */
  transferCountFor(paymentId: string): number {
    return this.transfers.get(paymentId) ?? 0;
  }
}

/** A fully wired set of real services over one shared store, for behavioural (property) testing. */
export interface Harness {
  store: FakeStore;
  repo: FakeCompletionRepository;
  intents: FakeReleaseIntentRepository;
  ratingsRepo: FakeServiceRatingRepository;
  escrow: FakeEscrowRelease;
  participation: CompletionParticipationService;
  creation: CompletionCreationService;
  decision: CompletionDecisionService;
  autoRelease: AutoReleaseService;
  ratings: RatingService;
  view: CompletionViewService;
}

/** Build a fresh harness (fresh store + wired real services). */
export function buildHarness(): Harness {
  const store = new FakeStore();
  const repo = new FakeCompletionRepository(store) as unknown as CompletionRepository;
  const intents = new FakeReleaseIntentRepository(store) as unknown as ReleaseIntentRepository;
  const ratingsRepo = new FakeServiceRatingRepository(store) as unknown as ServiceRatingRepository;
  const escrow = new FakeEscrowRelease();
  const participation = new CompletionParticipationService();
  const creation = new CompletionCreationService(repo);
  const decision = new CompletionDecisionService(repo, participation);
  const autoRelease = new AutoReleaseService(repo);
  const ratings = new RatingService(repo, ratingsRepo, participation);
  const view = new CompletionViewService(repo, intents, participation);
  return {
    store,
    repo: repo as unknown as FakeCompletionRepository,
    intents: intents as unknown as FakeReleaseIntentRepository,
    ratingsRepo: ratingsRepo as unknown as FakeServiceRatingRepository,
    escrow,
    participation,
    creation,
    decision,
    autoRelease,
    ratings,
    view,
  };
}
