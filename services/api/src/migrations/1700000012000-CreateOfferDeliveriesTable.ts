import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOfferDeliveriesTable1700000012000 implements MigrationInterface {
  name = 'CreateOfferDeliveriesTable1700000012000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Offer deliveries — tracks each individual delivery attempt to a Cleaner,
    // enabling tier-based delivery (Favorites → PRO → FREE), delivery status tracking,
    // and fallback channel logic (WebSocket → Push)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "offer_deliveries" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        -- Reference to the parent offer (cascades on delete — deliveries are meaningless without their offer)
        "offer_id" UUID NOT NULL,

        -- Target Cleaner (SET NULL preserves delivery audit history when a Cleaner account is deleted)
        "cleaner_id" UUID,

        -- Delivery tier determines priority order: Favorites receive first, then PRO, then FREE
        "tier" VARCHAR(10) NOT NULL,

        -- Tracks delivery lifecycle: PENDING → SENT or FAILED
        "delivery_status" VARCHAR(10) NOT NULL DEFAULT 'PENDING',

        -- Channel used for successful delivery (NULL while PENDING, set on SENT)
        "delivery_channel" VARCHAR(20),

        -- Reason for delivery failure (NULL unless status is FAILED)
        "failure_reason" TEXT,

        -- Which radius expansion step generated this delivery (enables stale-job detection)
        "radius_step" INTEGER NOT NULL,

        -- When the delivery record was created (queued for delivery)
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

        -- When the delivery was successfully sent to the Cleaner (NULL until SENT)
        "delivered_at" TIMESTAMP WITH TIME ZONE,

        -- Tier validation: only allowed delivery tiers
        CONSTRAINT "chk_tier" CHECK ("tier" IN ('FAVORITE', 'PRO', 'FREE')),

        -- Status validation: only allowed delivery states
        CONSTRAINT "chk_status" CHECK ("delivery_status" IN ('PENDING', 'SENT', 'FAILED')),

        -- Channel validation: NULL while pending, must be a known channel when set
        CONSTRAINT "chk_channel" CHECK (
          "delivery_channel" IS NULL OR "delivery_channel" IN ('WEBSOCKET', 'PUSH')
        ),

        -- Uniqueness: each Cleaner receives an offer at most once (prevents duplicate deliveries)
        CONSTRAINT "uq_offer_delivery" UNIQUE ("offer_id", "cleaner_id"),

        -- Foreign key with CASCADE: deliveries are deleted when the parent offer is removed
        CONSTRAINT "FK_offer_deliveries_offer_id"
          FOREIGN KEY ("offer_id") REFERENCES "offers" ("id") ON DELETE CASCADE,

        -- Foreign key with SET NULL: preserves delivery history when a Cleaner is deleted
        CONSTRAINT "FK_offer_deliveries_cleaner_id"
          FOREIGN KEY ("cleaner_id") REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);

    // Index on offer_id for FK lookups and filtering deliveries by offer
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_offer_deliveries_offer"
        ON "offer_deliveries" ("offer_id")
    `);

    // Index on cleaner_id for querying a Cleaner's received offers
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_offer_deliveries_cleaner"
        ON "offer_deliveries" ("cleaner_id")
    `);

    // Composite index on (offer_id, delivery_status) for filtering deliveries by state within an offer
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_offer_deliveries_offer_status"
        ON "offer_deliveries" ("offer_id", "delivery_status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_offer_deliveries_offer_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_offer_deliveries_cleaner"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_offer_deliveries_offer"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "offer_deliveries"`);
  }
}
