import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOfferStateTransitionsTable1700000011000 implements MigrationInterface {
  name = 'CreateOfferStateTransitionsTable1700000011000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Offer state transitions — audit log tracking every lifecycle state change for an offer
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "offer_state_transitions" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        -- Reference to the parent offer (cascades on delete — transitions are meaningless without their offer)
        "offer_id" UUID NOT NULL,

        -- Previous state (NULL for the initial creation transition: → DRAFT)
        "from_state" VARCHAR(20),

        -- Target state after the transition
        "to_state" VARCHAR(20) NOT NULL,

        -- Who or what triggered this transition (e.g., 'host', 'system', 'scheduler', 'cleaner')
        "triggered_by" VARCHAR(50) NOT NULL,

        -- Optional context payload (e.g., cancellation reason, expansion step, matched cleaner ID)
        "metadata" JSONB,

        -- When the transition occurred
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

        -- State validation: from_state must be a valid lifecycle state or NULL (initial transition)
        CONSTRAINT "chk_from_state" CHECK (
          "from_state" IS NULL OR "from_state" IN ('DRAFT', 'PUBLISHED', 'ACTIVE', 'MATCHED', 'COMPLETED', 'CANCELLED', 'EXPIRED')
        ),

        -- State validation: to_state must always be a valid lifecycle state
        CONSTRAINT "chk_to_state" CHECK (
          "to_state" IN ('DRAFT', 'PUBLISHED', 'ACTIVE', 'MATCHED', 'COMPLETED', 'CANCELLED', 'EXPIRED')
        ),

        -- Foreign key with CASCADE: transitions are deleted when the parent offer is removed
        CONSTRAINT "FK_offer_state_transitions_offer_id"
          FOREIGN KEY ("offer_id") REFERENCES "offers" ("id") ON DELETE CASCADE
      )
    `);

    // Index on offer_id for FK lookups and filtering transitions by offer
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_offer_transitions_offer"
        ON "offer_state_transitions" ("offer_id")
    `);

    // Composite index on (offer_id, created_at) for chronological transition history queries
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_offer_transitions_offer_time"
        ON "offer_state_transitions" ("offer_id", "created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_offer_transitions_offer_time"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_offer_transitions_offer"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "offer_state_transitions"`);
  }
}
