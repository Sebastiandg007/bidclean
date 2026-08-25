import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOffersTable1700000010000 implements MigrationInterface {
  name = 'CreateOffersTable1700000010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Offers table — cleaning service offers published by Hosts, delivered to Cleaners
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "offers" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        -- Ownership references
        "host_id" UUID NOT NULL,
        "property_id" UUID NOT NULL,

        -- Service details
        "service_type" VARCHAR(30) NOT NULL,
        "description" TEXT,
        "scheduled_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "timezone" VARCHAR(64) NOT NULL,
        "estimated_duration_minutes" INTEGER NOT NULL,

        -- Pricing (all in cents — integer arithmetic only, no floating-point)
        "offered_price_cents" INTEGER NOT NULL,
        "currency" CHAR(3) NOT NULL,
        "host_service_fee_cents" INTEGER NOT NULL,
        "host_total_cents" INTEGER NOT NULL,
        "cleaner_commission_cents" INTEGER NOT NULL,
        "cleaner_payout_cents" INTEGER NOT NULL,

        -- Rate snapshot (basis points at time of creation — immutable after persist)
        "host_service_fee_rate_bps" INTEGER NOT NULL,
        "cleaner_commission_rate_bps" INTEGER NOT NULL,

        -- Property snapshot (immutable after publish — denormalized for offer history)
        "property_name_snapshot" VARCHAR(255),
        "property_type_snapshot" VARCHAR(30),
        "property_city_snapshot" VARCHAR(100),
        "property_cover_photo_snapshot" TEXT,

        -- State machine
        "state" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',

        -- Delivery configuration
        "favorites_first" BOOLEAN NOT NULL DEFAULT false,

        -- Radius expansion tracking
        "current_radius_meters" INTEGER NOT NULL DEFAULT 0,
        "expansion_step_count" INTEGER NOT NULL DEFAULT 0,

        -- Idempotency (prevents duplicate offer creation on retry)
        "idempotency_key" VARCHAR(255),

        -- Lifecycle timestamps
        "published_at" TIMESTAMP WITH TIME ZONE,
        "expired_at" TIMESTAMP WITH TIME ZONE,
        "cancelled_at" TIMESTAMP WITH TIME ZONE,
        "matched_at" TIMESTAMP WITH TIME ZONE,
        "completed_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

        -- State constraint: only allowed lifecycle states
        CONSTRAINT "chk_state" CHECK ("state" IN ('DRAFT', 'PUBLISHED', 'ACTIVE', 'MATCHED', 'COMPLETED', 'CANCELLED', 'EXPIRED')),

        -- Service type constraint: allowed service categories
        CONSTRAINT "chk_service_type" CHECK ("service_type" IN ('standard', 'deep', 'move_in_out', 'post_construction', 'post_event', 'recurring')),

        -- Pricing invariants (integer arithmetic verification)
        CONSTRAINT "chk_price_positive" CHECK ("offered_price_cents" > 0),
        CONSTRAINT "chk_duration_bounds" CHECK ("estimated_duration_minutes" > 0),
        CONSTRAINT "chk_host_total" CHECK ("host_total_cents" = "offered_price_cents" + "host_service_fee_cents"),
        CONSTRAINT "chk_cleaner_payout" CHECK ("cleaner_payout_cents" = "offered_price_cents" - "cleaner_commission_cents"),

        -- Foreign keys with RESTRICT (prevent deletion of referenced user/property while offers exist)
        CONSTRAINT "FK_offers_host_id"
          FOREIGN KEY ("host_id") REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_offers_property_id"
          FOREIGN KEY ("property_id") REFERENCES "properties" ("id") ON DELETE RESTRICT
      )
    `);

    // Index on host_id for listing host's offers (FK index)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_offers_host"
        ON "offers" ("host_id")
    `);

    // Partial index for active offers by host (performance: filtered to non-terminal states)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_offers_host_active"
        ON "offers" ("host_id", "state")
        WHERE "state" IN ('DRAFT', 'PUBLISHED', 'ACTIVE')
    `);

    // Index on state for filtering offers by lifecycle state
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_offers_state"
        ON "offers" ("state")
    `);

    // Index on created_at DESC for chronological listing
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_offers_created"
        ON "offers" ("created_at" DESC)
    `);

    // UNIQUE partial: prevents duplicate offer creation on retry (idempotency)
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_offers_idempotency"
        ON "offers" ("host_id", "idempotency_key")
        WHERE "idempotency_key" IS NOT NULL
    `);

    // CRITICAL: Prevents concurrent creation of multiple active offers per property
    // Only one DRAFT, PUBLISHED, or ACTIVE offer may exist per property at a time
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_one_active_offer_per_property"
        ON "offers" ("property_id")
        WHERE "state" IN ('DRAFT', 'PUBLISHED', 'ACTIVE')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_one_active_offer_per_property"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_offers_idempotency"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_offers_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_offers_state"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_offers_host_active"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_offers_host"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "offers"`);
  }
}
