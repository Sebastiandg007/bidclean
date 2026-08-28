import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNegotiationTables1700000013000 implements MigrationInterface {
  name = 'CreateNegotiationTables1700000013000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // negotiation_threads — one thread per (offer, host, cleaner). Holds the pointer to the
    // current PENDING proposal, a monotonic version for event ordering, and the immutable
    // base_price_cents snapshot used as the deviation reference.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "negotiation_threads" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        -- Offer being negotiated (cascades on delete — threads are meaningless without their offer)
        "offer_id" UUID NOT NULL,

        -- Host who owns the offer (RESTRICT preserves referential integrity while threads exist)
        "host_id" UUID NOT NULL,

        -- Cleaner participating in this thread
        "cleaner_id" UUID NOT NULL,

        -- Thread lifecycle: OPEN while the offer is ACTIVE, CLOSED when the offer becomes terminal
        "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',

        -- Pointer to the current PENDING proposal (NULL until the first proposal is created)
        "current_proposal_id" UUID,

        -- Count of every proposal ever created in this thread (including terminal ones)
        "proposal_count" INTEGER NOT NULL DEFAULT 0,

        -- Monotonic version bumped on every mutation (used for real-time event ordering)
        "version" INTEGER NOT NULL DEFAULT 0,

        -- Immutable snapshot of the offer's offered_price_cents at thread creation (deviation reference)
        "base_price_cents" INTEGER NOT NULL,

        -- ISO 4217 currency code inherited from the offer
        "currency" CHAR(3) NOT NULL,

        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

        -- One thread per (offer, host, cleaner)
        CONSTRAINT "uq_negotiation_thread" UNIQUE ("offer_id", "host_id", "cleaner_id"),

        -- Status validation
        CONSTRAINT "chk_thread_status" CHECK ("status" IN ('OPEN', 'CLOSED')),

        -- Base price must be positive (integer cents)
        CONSTRAINT "chk_thread_base_price" CHECK ("base_price_cents" > 0),

        -- Foreign keys
        CONSTRAINT "FK_negotiation_threads_offer_id"
          FOREIGN KEY ("offer_id") REFERENCES "offers" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_negotiation_threads_host_id"
          FOREIGN KEY ("host_id") REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_negotiation_threads_cleaner_id"
          FOREIGN KEY ("cleaner_id") REFERENCES "users" ("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_negotiation_threads_offer"
        ON "negotiation_threads" ("offer_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_negotiation_threads_host"
        ON "negotiation_threads" ("host_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_negotiation_threads_cleaner"
        ON "negotiation_threads" ("cleaner_id")
    `);

    // negotiation_proposals — generic proposal rows (CLEANER or HOST actor) within a thread.
    // The partial unique index guarantees at most one PENDING proposal per thread (Property P4).
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "negotiation_proposals" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        -- Parent thread (cascades on delete)
        "thread_id" UUID NOT NULL,

        -- Who authored this proposal
        "actor" VARCHAR(10) NOT NULL,

        -- Strictly increasing position within the thread (Property P5)
        "sequence_number" INTEGER NOT NULL,

        -- Proposed price in cents (integer arithmetic only)
        "proposed_price_cents" INTEGER NOT NULL,

        -- Derived Cleaner payout via CommissionService (offer's snapshotted rates)
        "cleaner_payout_cents" INTEGER NOT NULL,

        -- Derived Host total via CommissionService (offer's snapshotted rates)
        "host_total_cents" INTEGER NOT NULL,

        -- ISO 4217 currency code
        "currency" CHAR(3) NOT NULL,

        -- Proposal lifecycle status (only PENDING is non-terminal)
        "status" VARCHAR(12) NOT NULL DEFAULT 'PENDING',

        -- Reason a proposal was superseded (NULL unless status = SUPERSEDED)
        "superseded_reason" VARCHAR(20),

        -- When this proposal's response window elapses (created_at + response window)
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,

        -- When the counterparty responded (NULL while PENDING)
        "responded_at" TIMESTAMP WITH TIME ZONE,

        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

        -- Actor validation
        CONSTRAINT "chk_proposal_actor" CHECK ("actor" IN ('CLEANER', 'HOST')),

        -- Status validation
        CONSTRAINT "chk_proposal_status" CHECK (
          "status" IN ('PENDING', 'ACCEPTED', 'REJECTED', 'COUNTERED', 'SUPERSEDED', 'EXPIRED')
        ),

        -- Superseded reason validation (NULL allowed; must be a known reason when set)
        CONSTRAINT "chk_proposal_superseded_reason" CHECK (
          "superseded_reason" IS NULL OR
          "superseded_reason" IN ('OFFER_MATCHED', 'OFFER_CANCELLED', 'OFFER_EXPIRED', 'DIRECT_ACCEPT')
        ),

        -- Price must be positive
        CONSTRAINT "chk_proposal_price_positive" CHECK ("proposed_price_cents" > 0),

        -- Sequence uniqueness within a thread (Property P5)
        CONSTRAINT "uq_proposal_thread_sequence" UNIQUE ("thread_id", "sequence_number"),

        -- Foreign key with CASCADE
        CONSTRAINT "FK_negotiation_proposals_thread_id"
          FOREIGN KEY ("thread_id") REFERENCES "negotiation_threads" ("id") ON DELETE CASCADE
      )
    `);

    // Property P4: at most ONE actionable PENDING proposal per thread
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_one_pending_per_thread"
        ON "negotiation_proposals" ("thread_id")
        WHERE "status" = 'PENDING'
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_negotiation_proposals_thread"
        ON "negotiation_proposals" ("thread_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_negotiation_proposals_status"
        ON "negotiation_proposals" ("status")
    `);
    // Sweep index for the expiration worker (only PENDING rows)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_negotiation_proposals_expiry"
        ON "negotiation_proposals" ("expires_at")
        WHERE "status" = 'PENDING'
    `);

    // negotiation_idempotency — caches serialized mutation results, scoped by
    // (user_id, operation, idempotency_key) so the same key reused across different
    // operations never collides (Property P9).
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "negotiation_idempotency" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        -- Acting user (Cleaner or Host)
        "user_id" UUID NOT NULL,

        -- Operation name (e.g. accept_offer, create_counteroffer, accept_proposal, ...)
        "operation" VARCHAR(50) NOT NULL,

        -- Client-generated idempotency key
        "idempotency_key" VARCHAR(255) NOT NULL,

        -- Serialized result to replay on retry
        "result_json" JSONB NOT NULL,

        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

        CONSTRAINT "uq_negotiation_idempotency" UNIQUE ("user_id", "operation", "idempotency_key")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "negotiation_idempotency"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_negotiation_proposals_expiry"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_negotiation_proposals_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_negotiation_proposals_thread"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_one_pending_per_thread"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "negotiation_proposals"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_negotiation_threads_cleaner"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_negotiation_threads_host"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_negotiation_threads_offer"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "negotiation_threads"`);
  }
}
