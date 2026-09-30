import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import {
  CHECKLIST_COMPLETION_PRECONDITION,
  CHECKLIST_PHOTO_MAX_PER_TASK,
  CHECKLIST_PHOTO_REQUIRED_POLICY,
  SERVICE_GEOFENCE_RADIUS_M,
  SERVICE_POSITION_MAX_ACCURACY_M,
  SERVICE_POSITION_MAX_AGE_MS,
  SERVICE_POSITION_MAX_CLOCK_SKEW_MS,
  serviceChannelForSession,
} from './service-tracking.constants';
import { GeofenceService } from './geofence.service';
import { ServiceSessionRepository, ServiceSessionRow } from './service-session.repository';
import {
  StartedChecklistSnapshot,
  buildArrivedOutboxRow,
  buildEnRouteOutboxRow,
  buildStartedOutboxRow,
} from './service-outbox';
import {
  ActivationPayload,
  EndedReason,
  PositionSample,
  SERVICE_ERROR_MESSAGES,
  ServiceSessionView,
  SessionState,
  isTerminalState,
} from './service-tracking.types';

/** The best-effort realtime publisher seam (server → Host). Bound to the reused CentrifugoClient. */
export interface ServiceRealtimePublisher {
  publish(channel: string, data: unknown): Promise<boolean>;
}

export const SERVICE_REALTIME_PUBLISHER = Symbol('SERVICE_REALTIME_PUBLISHER');

/**
 * ServiceSessionService — the session state machine + position ingress (Spec 17, Option A).
 *
 * PostgreSQL is authoritative; Centrifugo is best-effort transport; the server owns the geofence
 * COMPUTATION. Every advancing/terminal transition is a single-winner conditional write that, in
 * the SAME transaction, sets the derived timestamps and writes the `service_outbox` event. Live
 * coordinates are ephemeral: evaluated then re-published, never persisted or logged verbatim (the
 * sole durable location datum is `arrival_distance_m`). Functions stay ≤30 lines, SRP.
 */
@Injectable()
export class ServiceSessionService {
  private readonly logger = new Logger(ServiceSessionService.name);

  constructor(
    private readonly repository: ServiceSessionRepository,
    private readonly geofence: GeofenceService,
    @Inject(SERVICE_REALTIME_PUBLISHER)
    private readonly publisher: ServiceRealtimePublisher,
  ) {}

  /**
   * Idempotent creation off the `service_activation_ready` fact: snapshot the property point +
   * configured radius, `ON CONFLICT (offer_id) DO NOTHING`. Never throws in a way that blocks the
   * batch or the already-committed match/escrow (the consumer wraps this per-row).
   */
  async createFromActivation(payload: ActivationPayload): Promise<void> {
    const created = await this.repository.createSession(payload, SERVICE_GEOFENCE_RADIUS_M);
    if (!created) {
      // No usable property snapshot at creation — the sweep expires such a session if one exists.
      this.logger.warn(`Activation for offer ${payload.offerId} had no usable property snapshot`);
    }
  }

  /** Cleaner marks heading out: single-winner MATCHED → EN_ROUTE (+ service_en_route). */
  async startEnRoute(sessionId: string, userId: string): Promise<ServiceSessionView> {
    const session = await this.requireCleaner(sessionId, userId);
    const winner = await this.repository.transition(
      sessionId,
      SessionState.MATCHED,
      SessionState.EN_ROUTE,
      { enRouteAt: true },
      buildEnRouteOutboxRow(this.outboxIds(session)),
      { touchProgress: true },
    );
    return this.requireWinner(winner, sessionId);
  }

  /**
   * Cleaner begins work: single-winner ARRIVED → IN_PROGRESS (+ service_started).
   *
   * The `service_started` event additionally carries the property's checklist + the checklist
   * policy snapshot as-of this IN_PROGRESS transition (Spec 19, backward-safe payload extension), so
   * checklist-photos can build a temporally-exact run without re-reading the live property/config.
   * Resolving the checklist is a read-only cross-module query (never writes the property) and never
   * blocks the transition — an unresolvable checklist yields a zero-task run downstream.
   */
  async start(sessionId: string, userId: string): Promise<ServiceSessionView> {
    const session = await this.requireCleaner(sessionId, userId);
    const snapshot = await this.resolveStartedSnapshot(session);
    const winner = await this.repository.transition(
      sessionId,
      SessionState.ARRIVED,
      SessionState.IN_PROGRESS,
      { startedAt: true, endedReason: EndedReason.STARTED },
      buildStartedOutboxRow(this.outboxIds(session), snapshot),
    );
    return this.requireWinner(winner, sessionId);
  }

  /** Resolve the checklist + policy snapshot carried on `service_started` (Spec 19). */
  private async resolveStartedSnapshot(
    session: ServiceSessionRow,
  ): Promise<StartedChecklistSnapshot> {
    const checklistItems = session.property_id
      ? await this.repository.resolvePropertyChecklistItems(session.property_id)
      : [];
    return {
      checklistItems,
      photoRequiredPolicy: CHECKLIST_PHOTO_REQUIRED_POLICY,
      completionPrecondition: CHECKLIST_COMPLETION_PRECONDITION,
      maxPhotosPerTask: CHECKLIST_PHOTO_MAX_PER_TASK,
    };
  }

  /** Explicit participant cancel: single-winner non-terminal → CANCELED (CANCELED_BY_PARTICIPANT). */
  async cancelByParticipant(sessionId: string, userId: string): Promise<ServiceSessionView> {
    const session = await this.requireParticipant(sessionId, userId);
    if (isTerminalState(session.state)) {
      return this.toView(session);
    }
    const winner = await this.repository.transition(
      sessionId,
      session.state as SessionState,
      SessionState.CANCELED,
      { endedReason: EndedReason.CANCELED_BY_PARTICIPANT },
      null,
    );
    return this.toView(winner ?? (await this.reload(sessionId)));
  }

  /**
   * Idempotent force-cancel for the offer's session (offer-terminal path). Best-effort, single-winner
   * per attempt; a session already terminal is a no-op. Never throws for the listener.
   */
  async forceCancelForOffer(offerId: string, reason: EndedReason): Promise<void> {
    const session = await this.repository.findByOfferId(offerId);
    if (!session || isTerminalState(session.state)) {
      return;
    }
    await this.repository.transition(
      session.id,
      session.state as SessionState,
      SessionState.CANCELED,
      { endedReason: reason },
      null,
    );
  }

  /** Participant-gated reconciliation read (authoritative state-machine truth). */
  async getSession(sessionId: string, userId: string): Promise<ServiceSessionView> {
    const session = await this.requireParticipant(sessionId, userId);
    return this.toView(session);
  }

  /**
   * Ingest a Cleaner position sample (EN_ROUTE): gate eligibility, run the geofence over the
   * snapshot, single-winner EN_ROUTE → ARRIVED on an eligible in-radius sample (server timestamp +
   * geodesic `arrival_distance_m` + service_arrived, in one tx), then ALWAYS best-effort re-publish
   * to the Host. Coordinates are never persisted or logged verbatim. Rate limiting runs upstream.
   */
  async ingestPosition(
    sessionId: string,
    userId: string,
    sample: PositionSample,
  ): Promise<ServiceSessionView> {
    const session = await this.requireCleaner(sessionId, userId);
    if (session.state !== SessionState.EN_ROUTE) {
      // Advisory position on a non-EN_ROUTE session is ignored for arrival; still relayed.
      await this.republish(sessionId, sample);
      return this.toView(session);
    }
    const arrived = await this.evaluateArrival(session, sample);
    await this.republish(sessionId, sample);
    return this.toView(arrived ?? (await this.reload(sessionId)));
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /** Evaluate eligibility + geofence and, on a pass, drive the single-winner ARRIVED write. */
  private async evaluateArrival(
    session: ServiceSessionRow,
    sample: PositionSample,
  ): Promise<ServiceSessionRow | null> {
    const now = Date.now();
    const eligible = this.geofence.isEligible(sample, now, {
      maxAccuracyM: SERVICE_POSITION_MAX_ACCURACY_M,
      maxAgeMs: SERVICE_POSITION_MAX_AGE_MS,
      maxClockSkewMs: SERVICE_POSITION_MAX_CLOCK_SKEW_MS,
    });
    if (!eligible) {
      return null;
    }
    await this.repository.touchProgress(session.id);
    const geofence = await this.geofence.isWithinGeofence(session.id, sample, session.geofence_radius_m);
    if (!geofence || !geofence.within) {
      return null;
    }
    return this.repository.transition(
      session.id,
      SessionState.EN_ROUTE,
      SessionState.ARRIVED,
      { arrivedAt: true, arrivalDistanceM: geofence.distanceM },
      buildArrivedOutboxRow(this.outboxIds(session), geofence.distanceM),
    );
  }

  /** Best-effort re-publish of the ephemeral position to the session channel (never persisted). */
  private async republish(sessionId: string, sample: PositionSample): Promise<void> {
    try {
      await this.publisher.publish(serviceChannelForSession(sessionId), {
        type: 'position',
        lat: sample.lat,
        lng: sample.lng,
        accuracy: sample.accuracy,
        heading: sample.heading ?? null,
        at: sample.at,
      });
    } catch {
      // Swallowed: correctness is unaffected; the Host reconciles via GET. Coordinates never logged.
      this.logger.warn(`Position re-publish failed for session ${sessionId}`);
    }
  }

  /** Load a session + assert the caller is a participant (404 missing / 403 non-participant). */
  private async requireParticipant(sessionId: string, userId: string): Promise<ServiceSessionRow> {
    const session = await this.repository.findById(sessionId);
    if (!session) {
      throw new NotFoundException(SERVICE_ERROR_MESSAGES.SESSION_NOT_FOUND);
    }
    if (session.host_id !== userId && session.cleaner_id !== userId) {
      throw new ForbiddenException(SERVICE_ERROR_MESSAGES.NOT_A_PARTICIPANT);
    }
    return session;
  }

  /** Load a session + assert the caller is the Cleaner (only the Cleaner advances the job). */
  private async requireCleaner(sessionId: string, userId: string): Promise<ServiceSessionRow> {
    const session = await this.requireParticipant(sessionId, userId);
    if (session.cleaner_id !== userId) {
      throw new ForbiddenException(SERVICE_ERROR_MESSAGES.NOT_THE_CLEANER);
    }
    return session;
  }

  /** A winner is required for an advancing transition; a lost race is an illegal-transition 409. */
  private requireWinner(winner: ServiceSessionRow | null, sessionId: string): ServiceSessionView {
    if (!winner) {
      throw new ConflictException(SERVICE_ERROR_MESSAGES.ILLEGAL_TRANSITION);
    }
    void sessionId;
    return this.toView(winner);
  }

  /** Reload a session (used after a lost single-winner race to return the now-current state). */
  private async reload(sessionId: string): Promise<ServiceSessionRow> {
    const session = await this.repository.findById(sessionId);
    if (!session) {
      throw new NotFoundException(SERVICE_ERROR_MESSAGES.SESSION_NOT_FOUND);
    }
    return session;
  }

  /** The ids every outbox event carries (never PII). `propertyId` is additive for Spec 19. */
  private outboxIds(session: ServiceSessionRow): {
    sessionId: string;
    offerId: string;
    cleanerId: string | null;
    hostId: string | null;
    propertyId: string | null;
  } {
    return {
      sessionId: session.id,
      offerId: session.offer_id,
      cleanerId: session.cleaner_id,
      hostId: session.host_id,
      propertyId: session.property_id,
    };
  }

  /** Project a raw session row to its client view (never a live coordinate; snapshot only). */
  private toView(session: ServiceSessionRow): ServiceSessionView {
    const propertyLocation =
      session.snapshot_lat !== null && session.snapshot_lng !== null
        ? { lat: session.snapshot_lat, lng: session.snapshot_lng }
        : null;
    return {
      id: session.id,
      offerId: session.offer_id,
      hostId: session.host_id,
      cleanerId: session.cleaner_id,
      propertyId: session.property_id,
      state: session.state as SessionState,
      endedReason: (session.ended_reason as EndedReason | null) ?? null,
      geofenceRadiusM: session.geofence_radius_m,
      propertyLocation,
      enRouteAt: session.en_route_at ? session.en_route_at.toISOString() : null,
      arrivedAt: session.arrived_at ? session.arrived_at.toISOString() : null,
      startedAt: session.started_at ? session.started_at.toISOString() : null,
      arrivalDistanceM: session.arrival_distance_m,
      createdAt: session.created_at.toISOString(),
    };
  }
}
