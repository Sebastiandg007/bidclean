import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { OutboxRow, writeOutbox } from '../common/outbox/outbox-writer';
import { ActivationPayload, EndedReason, SessionState } from './service-tracking.types';

/** Raw `service_sessions` row shape (snake_case) returned by parameterized queries. */
export interface ServiceSessionRow {
  readonly id: string;
  readonly offer_id: string;
  readonly host_id: string | null;
  readonly cleaner_id: string | null;
  readonly property_id: string | null;
  readonly state: string;
  readonly ended_reason: string | null;
  readonly geofence_radius_m: number;
  readonly en_route_at: Date | null;
  readonly arrived_at: Date | null;
  readonly started_at: Date | null;
  readonly arrival_distance_m: number | null;
  readonly last_progress_at: Date | null;
  readonly created_at: Date;
  /** The snapshot centre projected as lng/lat scalars (never a coordinate stream). */
  readonly snapshot_lng: number | null;
  readonly snapshot_lat: number | null;
}

/** Derived fields a single-winner transition may set atomically with the state change. */
export interface TransitionDerivedFields {
  readonly enRouteAt?: boolean;
  readonly arrivedAt?: boolean;
  readonly startedAt?: boolean;
  readonly arrivalDistanceM?: number;
  readonly endedReason?: EndedReason;
}

/** An upstream `service_activation_ready` row awaiting consumption. */
export interface UnconsumedActivationRow {
  readonly eventId: string;
  readonly payload: ActivationPayload;
}

/** A `service_outbox` row a consumer has not yet acked. */
export interface UnackedOutboxRow {
  readonly eventId: string;
  readonly type: string;
  readonly aggregateId: string;
  readonly payload: Record<string, unknown>;
}

/** The full SELECT list for a session row, kept once so every read returns the same shape. */
const SELECT_COLUMNS = `
  "id", "offer_id", "host_id", "cleaner_id", "property_id", "state", "ended_reason",
  "geofence_radius_m", "en_route_at", "arrived_at", "started_at", "arrival_distance_m",
  "last_progress_at", "created_at",
  ST_X("property_location_snapshot"::geometry) AS "snapshot_lng",
  ST_Y("property_location_snapshot"::geometry) AS "snapshot_lat"
`;

/**
 * ServiceSessionRepository (`service_sessions` + `service_outbox` + checkpoints) — parameterized
 * SQL only (Spec 17).
 *
 * The authoritative lifecycle guarantee is the SINGLE-WINNER conditional write: a transition is
 * `UPDATE ... WHERE id=:id AND state=:expected RETURNING ...`, so under N concurrent actors exactly
 * one observes `rowCount = 1` (the winner, which sets the derived fields AND writes the
 * `service_outbox` row in the SAME transaction) and every other observes `rowCount = 0` and no-ops.
 * The geofence `ST_DWithin`/`ST_Distance` run over the session's `property_location_snapshot` (never
 * the live property row). Coordinates are never logged or persisted as a trail.
 */
@Injectable()
export class ServiceSessionRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Idempotent creation off the activation fact: snapshot the property point + configured radius,
   * `INSERT ... ON CONFLICT (offer_id) DO NOTHING`. A redelivered/concurrent attempt is a no-op
   * (returns the existing row) — `UNIQUE offer_id` is the hard guarantee. Returns null only if the
   * property has no resolvable location (the caller decides how to handle an unusable snapshot).
   */
  async createSession(
    payload: ActivationPayload,
    geofenceRadiusM: number,
  ): Promise<ServiceSessionRow | null> {
    const inserted = await this.dataSource.query<ServiceSessionRow[]>(
      `INSERT INTO "service_sessions"
         ("offer_id", "host_id", "cleaner_id", "property_id", "geofence_radius_m",
          "property_location_snapshot", "state")
       SELECT $1, $2, $3, $4, $5, p."location", '${SessionState.MATCHED}'
       FROM "properties" p
       WHERE p."id" = $4
       ON CONFLICT ("offer_id") DO NOTHING
       RETURNING ${SELECT_COLUMNS}`,
      [
        payload.offerId,
        payload.hostId,
        payload.cleanerId,
        payload.propertyId,
        geofenceRadiusM,
      ],
    );
    const row = inserted[0];
    if (row) {
      return row;
    }
    // Either a conflict (session already exists) or the property had no row. Distinguish by
    // reading the existing session — a conflict returns it (idempotent), a missing property null.
    return this.findByOfferId(payload.offerId);
  }

  /** Load a session by id (reconciliation / authorization). */
  async findById(id: string): Promise<ServiceSessionRow | null> {
    const rows = await this.dataSource.query<ServiceSessionRow[]>(
      `SELECT ${SELECT_COLUMNS} FROM "service_sessions" WHERE "id" = $1 LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  }

  /** Load a session by its (unique) offer id. */
  async findByOfferId(offerId: string): Promise<ServiceSessionRow | null> {
    const rows = await this.dataSource.query<ServiceSessionRow[]>(
      `SELECT ${SELECT_COLUMNS} FROM "service_sessions" WHERE "offer_id" = $1 LIMIT 1`,
      [offerId],
    );
    return rows[0] ?? null;
  }

  /**
   * Single-winner state transition. `UPDATE ... WHERE id=:id AND state=:expected` sets the derived
   * timestamps/fields AND writes the `service_outbox` row in ONE transaction. Returns the updated
   * row for the winner, or null when the session was not in `expected` (already advanced/terminal →
   * idempotent no-op for the loser). `last_progress_at` is bumped whenever `touchProgress` is set.
   */
  async transition(
    id: string,
    expected: SessionState,
    next: SessionState,
    derived: TransitionDerivedFields,
    outbox: OutboxRow | null,
    options: { readonly touchProgress?: boolean } = {},
  ): Promise<ServiceSessionRow | null> {
    return this.dataSource.transaction(async (manager: EntityManager) => {
      const rows = await manager.query<ServiceSessionRow[]>(
        `UPDATE "service_sessions"
         SET "state" = $3,
             "en_route_at" = CASE WHEN $4 THEN COALESCE("en_route_at", NOW()) ELSE "en_route_at" END,
             "arrived_at" = CASE WHEN $5 THEN COALESCE("arrived_at", NOW()) ELSE "arrived_at" END,
             "started_at" = CASE WHEN $6 THEN COALESCE("started_at", NOW()) ELSE "started_at" END,
             "arrival_distance_m" = COALESCE($7, "arrival_distance_m"),
             "ended_reason" = COALESCE($8, "ended_reason"),
             "last_progress_at" = CASE WHEN $9 THEN NOW() ELSE "last_progress_at" END,
             "updated_at" = NOW()
         WHERE "id" = $1 AND "state" = $2
         RETURNING ${SELECT_COLUMNS}`,
        [
          id,
          expected,
          next,
          derived.enRouteAt === true,
          derived.arrivedAt === true,
          derived.startedAt === true,
          derived.arrivalDistanceM ?? null,
          derived.endedReason ?? null,
          options.touchProgress === true,
        ],
      );
      const winner = rows[0];
      if (!winner) {
        return null;
      }
      if (outbox) {
        await writeOutbox(manager, outbox);
      }
      return winner;
    });
  }

  /**
   * Bump `last_progress_at` for an EN_ROUTE session on an eligible sample that did NOT arrive.
   * A no-op when the session left EN_ROUTE concurrently. Never persists a coordinate.
   */
  async touchProgress(id: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE "service_sessions"
       SET "last_progress_at" = NOW(), "updated_at" = NOW()
       WHERE "id" = $1 AND "state" = '${SessionState.EN_ROUTE}'`,
      [id],
    );
  }

  /**
   * The geofence check over the session's SNAPSHOT (not the live property row): returns whether the
   * reported point is within `radiusM` and the geometric geodesic distance in metres. Uses the
   * snapshot so a config change or mid-session property edit never retroactively alters an in-flight
   * session. Returns null when the snapshot is unusable (no session/point).
   */
  async evaluateGeofence(
    id: string,
    lng: number,
    lat: number,
    radiusM: number,
  ): Promise<{ within: boolean; distanceM: number } | null> {
    const rows = await this.dataSource.query<
      Array<{ within: boolean; distance_m: number }>
    >(
      `SELECT
         ST_DWithin("property_location_snapshot", ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4) AS "within",
         ST_Distance("property_location_snapshot", ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography) AS "distance_m"
       FROM "service_sessions"
       WHERE "id" = $1
       LIMIT 1`,
      [id, lng, lat, radiusM],
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    return { within: row.within, distanceM: Math.round(row.distance_m) };
  }

  /** MATCHED sessions created before `before` (abandon sweep input). Oldest-first, bounded. */
  async findAbandonedMatched(before: Date, limit: number): Promise<string[]> {
    const rows = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT "id" FROM "service_sessions"
       WHERE "state" = '${SessionState.MATCHED}' AND "created_at" < $1
       ORDER BY "created_at" ASC
       LIMIT $2`,
      [before, limit],
    );
    return rows.map((row) => row.id);
  }

  /**
   * EN_ROUTE sessions with no eligible progress since `before` (stale sweep input). Progress is
   * tracked by `last_progress_at`; a session that never reported falls back to `en_route_at`.
   * Oldest-first, bounded.
   */
  async findExpirableEnRoute(before: Date, limit: number): Promise<string[]> {
    const rows = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT "id" FROM "service_sessions"
       WHERE "state" = '${SessionState.EN_ROUTE}'
         AND COALESCE("last_progress_at", "en_route_at", "created_at") < $1
       ORDER BY COALESCE("last_progress_at", "en_route_at", "created_at") ASC
       LIMIT $2`,
      [before, limit],
    );
    return rows.map((row) => row.id);
  }

  // ─── Activation cursor (service-tracking's own upstream checkpoint) ───────────

  /** Upstream `service_activation_ready` rows not yet acked by service-tracking. Oldest-first. */
  async findActivationUnconsumed(limit: number): Promise<UnconsumedActivationRow[]> {
    const rows = await this.dataSource.query<
      Array<{ event_id: string; payload: ActivationPayload }>
    >(
      `SELECT o."event_id", o."payload"
       FROM "service_activation_outbox" o
       WHERE NOT EXISTS (
         SELECT 1 FROM "service_activation_consumed" c
         WHERE c."upstream_event_id" = o."event_id"
       )
       ORDER BY o."created_at" ASC
       LIMIT $1`,
      [limit],
    );
    return rows.map((row) => ({ eventId: row.event_id, payload: row.payload }));
  }

  /** Record service-tracking's ack of an upstream activation row (idempotent). */
  async markActivationConsumed(upstreamEventId: string): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO "service_activation_consumed" ("upstream_event_id")
       VALUES ($1)
       ON CONFLICT ("upstream_event_id") DO NOTHING`,
      [upstreamEventId],
    );
  }

  // ─── Outbox fan-out (per-consumer checkpoint) ─────────────────────────────────

  /** `service_outbox` rows with no ack for `consumerName` (its unrelayed scan). Oldest-first. */
  async findOutboxUnackedFor(consumerName: string, limit: number): Promise<UnackedOutboxRow[]> {
    const rows = await this.dataSource.query<
      Array<{ event_id: string; type: string; aggregate_id: string; payload: Record<string, unknown> }>
    >(
      `SELECT o."event_id", o."type", o."aggregate_id", o."payload"
       FROM "service_outbox" o
       WHERE NOT EXISTS (
         SELECT 1 FROM "service_outbox_consumers" c
         WHERE c."event_id" = o."event_id" AND c."consumer_name" = $1
       )
       ORDER BY o."created_at" ASC
       LIMIT $2`,
      [consumerName, limit],
    );
    return rows.map((row) => ({
      eventId: row.event_id,
      type: row.type,
      aggregateId: row.aggregate_id,
      payload: row.payload,
    }));
  }

  /** Ack a `service_outbox` event for one consumer (idempotent per `(event_id, consumer_name)`). */
  async ackOutboxFor(eventId: string, consumerName: string): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO "service_outbox_consumers" ("event_id", "consumer_name")
       VALUES ($1, $2)
       ON CONFLICT ("event_id", "consumer_name") DO NOTHING`,
      [eventId, consumerName],
    );
  }
}
