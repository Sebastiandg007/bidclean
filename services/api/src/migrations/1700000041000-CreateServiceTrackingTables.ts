import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Service-tracking schema (Spec 17).
 *
 * Creates the durable execution-lifecycle table `service_sessions`, the fan-out `service_outbox`
 * (+ per-consumer checkpoint `service_outbox_consumers`), service-tracking's own upstream
 * consumption cursor `service_activation_consumed`, and the emitter-owned `service_activation_outbox`
 * (written by the offer/escrow path in the same tx as the escrow HELD transition).
 *
 * Invariants encoded here:
 * - Live coordinates are NEVER persisted: `service_sessions` has only the scalar `arrival_distance_m`
 *   (no breadcrumb/route column) and no `deleted_at` (a terminal-for-tracking session is an
 *   immutable audit fact).
 * - Deletion coherence (Spec 13): `offer_id` CASCADE; `host_id`/`cleaner_id`/`property_id` SET NULL
 *   (never a user-cascade).
 * - The geofence uses `property_location_snapshot` captured at creation, so it survives a
 *   mid-session property deletion.
 * - `service_outbox` carries NO shared `relayed_at`; per-consumer progress lives in
 *   `service_outbox_consumers (event_id, consumer_name)`.
 *
 * Reversible: `down()` drops in dependency order (`service_outbox_consumers` before `service_outbox`).
 */
export class CreateServiceTrackingTables1700000041000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── service_sessions ──────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "service_sessions" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "offer_id" UUID NOT NULL,
        "host_id" UUID,
        "cleaner_id" UUID,
        "property_id" UUID,
        "property_location_snapshot" GEOGRAPHY(Point, 4326) NOT NULL,
        "geofence_radius_m" INTEGER NOT NULL,
        "state" VARCHAR(20) NOT NULL DEFAULT 'MATCHED',
        "ended_reason" VARCHAR(30),
        "en_route_at" TIMESTAMP WITH TIME ZONE,
        "arrived_at" TIMESTAMP WITH TIME ZONE,
        "started_at" TIMESTAMP WITH TIME ZONE,
        "arrival_distance_m" INTEGER,
        "last_progress_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        CONSTRAINT "chk_service_sessions_state"
          CHECK ("state" IN ('MATCHED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'CANCELED', 'EXPIRED')),
        CONSTRAINT "chk_service_sessions_ended_reason"
          CHECK ("ended_reason" IS NULL OR "ended_reason" IN (
            'STARTED', 'CANCELED_OFFER_TERMINAL', 'CANCELED_BY_PARTICIPANT',
            'EXPIRED_NO_PROGRESS', 'EXPIRED_NEVER_STARTED', 'EXPIRED_PROPERTY_REMOVED'
          )),
        CONSTRAINT "chk_service_sessions_radius_positive" CHECK ("geofence_radius_m" > 0),
        CONSTRAINT "FK_service_sessions_offer"
          FOREIGN KEY ("offer_id") REFERENCES "offers" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_service_sessions_host"
          FOREIGN KEY ("host_id") REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_service_sessions_cleaner"
          FOREIGN KEY ("cleaner_id") REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_service_sessions_property"
          FOREIGN KEY ("property_id") REFERENCES "properties" ("id") ON DELETE SET NULL
      )
    `);
    // One session per matched offer — the idempotency backstop behind at-least-once activation.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_service_sessions_offer"
        ON "service_sessions" ("offer_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_service_sessions_host"
        ON "service_sessions" ("host_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_service_sessions_cleaner"
        ON "service_sessions" ("cleaner_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_service_sessions_property"
        ON "service_sessions" ("property_id")
    `);
    // Bounded sweep scan over the non-terminal states only.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_service_sessions_sweep"
        ON "service_sessions" ("state", "last_progress_at")
        WHERE "state" IN ('MATCHED', 'EN_ROUTE')
    `);
    await queryRunner.query(
      `COMMENT ON TABLE "service_sessions" IS 'Durable execution lifecycle of a matched+charged offer (Spec 17). Never holds live coordinates; the sole durable location datum is arrival_distance_m.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "service_sessions"."property_location_snapshot" IS 'Geofence centre captured at creation; survives a mid-session property deletion.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "service_sessions"."arrival_distance_m" IS 'The ONLY durable location-derived datum: server-observed geodesic distance at the geofence crossing.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "service_sessions"."last_progress_at" IS 'Scalar timestamp updated on each eligible EN_ROUTE sample; drives the stale sweep (not a coordinate).'`,
    );

    // ─── service_outbox (fan-out source; NO shared relayed_at) ────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "service_outbox" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "event_id" VARCHAR(255) NOT NULL,
        "aggregate_type" VARCHAR(30) NOT NULL DEFAULT 'service_session',
        "aggregate_id" UUID NOT NULL,
        "type" VARCHAR(50) NOT NULL,
        "payload" JSONB NOT NULL,
        "version" INTEGER NOT NULL DEFAULT 1,
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        CONSTRAINT "uq_service_outbox_event" UNIQUE ("event_id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_service_outbox_created"
        ON "service_outbox" ("created_at")
    `);
    await queryRunner.query(
      `COMMENT ON TABLE "service_outbox" IS 'Durable service_* transition events written in the same TX as the single-winner state change; fanned out to independent per-consumer checkpoints (no shared relayed_at).'`,
    );

    // ─── service_outbox_consumers (per-consumer acknowledgement checkpoint) ───────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "service_outbox_consumers" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "event_id" VARCHAR(255) NOT NULL,
        "consumer_name" VARCHAR(50) NOT NULL,
        "processed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT "uq_service_outbox_consumers_event_consumer" UNIQUE ("event_id", "consumer_name"),
        CONSTRAINT "FK_service_outbox_consumers_event"
          FOREIGN KEY ("event_id") REFERENCES "service_outbox" ("event_id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_service_outbox_consumers_consumer"
        ON "service_outbox_consumers" ("consumer_name")
    `);
    await queryRunner.query(
      `COMMENT ON TABLE "service_outbox_consumers" IS 'Per-consumer ack of a service_outbox event; each consumer drains events lacking its own (event_id, consumer_name) row, so one consumer never starves another.'`,
    );

    // ─── service_activation_outbox (emitter-owned; offer/escrow writes it) ────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "service_activation_outbox" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "event_id" VARCHAR(255) NOT NULL,
        "aggregate_type" VARCHAR(30) NOT NULL DEFAULT 'service_activation',
        "aggregate_id" UUID NOT NULL,
        "type" VARCHAR(50) NOT NULL,
        "payload" JSONB NOT NULL,
        "version" INTEGER NOT NULL DEFAULT 1,
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        CONSTRAINT "uq_service_activation_outbox_event" UNIQUE ("event_id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_service_activation_outbox_created"
        ON "service_activation_outbox" ("created_at")
    `);
    await queryRunner.query(
      `COMMENT ON TABLE "service_activation_outbox" IS 'Durable service_activation_ready fact (offer MATCHED AND escrow CAPTURED) written by the offer/escrow path in the same TX as the escrow HELD transition; drained by service-tracking via its own service_activation_consumed cursor.'`,
    );

    // ─── service_activation_consumed (service-tracking's own upstream cursor) ─────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "service_activation_consumed" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "upstream_event_id" VARCHAR(255) NOT NULL,
        "consumed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT "uq_service_activation_consumed_event" UNIQUE ("upstream_event_id")
      )
    `);
    await queryRunner.query(
      `COMMENT ON TABLE "service_activation_consumed" IS 'service-tracking''s own per-consumer checkpoint over the upstream service_activation_outbox (never mutates a shared relayed_at); createFromActivation stays idempotent on UNIQUE offer_id.'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "service_activation_consumed"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_service_activation_outbox_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "service_activation_outbox"`);
    // Dependency order: the consumer checkpoint FKs service_outbox(event_id), so drop it first.
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_service_outbox_consumers_consumer"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "service_outbox_consumers"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_service_outbox_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "service_outbox"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_service_sessions_sweep"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_service_sessions_property"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_service_sessions_cleaner"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_service_sessions_host"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_service_sessions_offer"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "service_sessions"`);
  }
}
