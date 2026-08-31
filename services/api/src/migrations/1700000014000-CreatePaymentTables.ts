import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the four payment tables for the Stripe Escrow module:
 * - payments: escrow aggregate (one row per matched offer) with three orthogonal
 *   lifecycles (payment_status, dispute_status, payout_status) and the money snapshot.
 * - payment_attempts: one row per PaymentIntent (charge attempt); retries add attempts.
 * - stripe_accounts: one Express Connected Account per Cleaner (payout gate).
 * - payment_events: append-only sanitized ledger for audit + webhook idempotency.
 *
 * Money is stored as integer minor units (cents). Statuses use VARCHAR + CHECK
 * (no PG enums). All money-mutating invariants are enforced by CHECK constraints.
 */
export class CreatePaymentTables1700000014000 implements MigrationInterface {
  name = 'CreatePaymentTables1700000014000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // payments — the escrow aggregate. One row per matched offer. Holds the money
    // snapshot (from CommissionService) and the three orthogonal statuses. Stripe
    // ids for the current intent/charge live on payment_attempts; the payout Transfer
    // id lives here.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payments" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        -- Offer being paid for (RESTRICT: a payment must not be orphaned by an offer delete)
        "offer_id" UUID NOT NULL,

        -- Host charged and Cleaner paid (RESTRICT preserves financial referential integrity)
        "host_id" UUID NOT NULL,
        "cleaner_id" UUID NOT NULL,

        -- Three orthogonal lifecycles
        "payment_status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        "dispute_status" VARCHAR(10) NOT NULL DEFAULT 'NONE',
        "payout_status" VARCHAR(20) NOT NULL DEFAULT 'NOT_READY',

        -- ISO 4217 currency inherited from the offer
        "currency" CHAR(3) NOT NULL,

        -- Money snapshot (integer minor units), from CommissionService
        "agreed_price_cents" INTEGER NOT NULL,
        "host_total_cents" INTEGER NOT NULL,
        "cleaner_payout_cents" INTEGER NOT NULL,
        "platform_gross_revenue_cents" INTEGER NOT NULL,
        "stripe_fee_cents" INTEGER NOT NULL DEFAULT 0,
        "net_platform_revenue_cents" INTEGER NOT NULL DEFAULT 0,
        "refunded_amount_cents" INTEGER NOT NULL DEFAULT 0,
        "reversed_amount_cents" INTEGER NOT NULL DEFAULT 0,

        -- Stripe payout Transfer reference (intent/charge ids live on attempts)
        "stripe_transfer_id" VARCHAR(255),

        -- Release coordination
        "held_at" TIMESTAMP WITH TIME ZONE,
        "released_at" TIMESTAMP WITH TIME ZONE,

        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

        -- P3: one payment per offer
        CONSTRAINT "uq_payment_offer" UNIQUE ("offer_id"),

        CONSTRAINT "chk_payment_status" CHECK ("payment_status" IN
          ('PENDING','PROCESSING','HELD','RELEASED','REFUNDED','PARTIALLY_REFUNDED','FAILED')),
        CONSTRAINT "chk_dispute_status" CHECK ("dispute_status" IN ('NONE','OPEN','WON','LOST')),
        CONSTRAINT "chk_payout_status" CHECK ("payout_status" IN
          ('NOT_READY','PENDING','TRANSFER_CREATED','PAID','REVERSED')),

        CONSTRAINT "chk_amounts_positive" CHECK
          ("agreed_price_cents" > 0 AND "host_total_cents" > 0 AND "cleaner_payout_cents" >= 0),

        -- P7: refunds never exceed what the Host paid
        CONSTRAINT "chk_refund_ceiling" CHECK
          ("refunded_amount_cents" >= 0 AND "refunded_amount_cents" <= "host_total_cents"),
        -- P7 companion: reversals never exceed the Cleaner's payout
        CONSTRAINT "chk_reversal_ceiling" CHECK
          ("reversed_amount_cents" >= 0 AND "reversed_amount_cents" <= "cleaner_payout_cents"),

        CONSTRAINT "FK_payments_offer_id"
          FOREIGN KEY ("offer_id") REFERENCES "offers" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_payments_host_id"
          FOREIGN KEY ("host_id") REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_payments_cleaner_id"
          FOREIGN KEY ("cleaner_id") REFERENCES "users" ("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_payments_host" ON "payments" ("host_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_payments_cleaner" ON "payments" ("cleaner_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_payments_status" ON "payments" ("payment_status")
    `);
    // Disputed payments (rare) — partial index keeps it small
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_payments_dispute"
        ON "payments" ("dispute_status") WHERE "dispute_status" <> 'NONE'
    `);
    // Auto-release sweep: held, not disputed, past the window (ordered by held_at)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_payments_auto_release"
        ON "payments" ("held_at")
        WHERE "payment_status" = 'HELD' AND "dispute_status" = 'NONE'
    `);
    // Deferred payout sweep: releases waiting on Cleaner onboarding
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_payments_pending_payout"
        ON "payments" ("cleaner_id") WHERE "payout_status" = 'PENDING'
    `);

    // payment_attempts — one row per PaymentIntent. A payment aggregates 1..N attempts;
    // a failed charge does not mutate a prior attempt's Stripe ids — it adds a new attempt.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payment_attempts" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        -- Parent payment (cascades on delete)
        "payment_id" UUID NOT NULL,

        -- Strictly increasing attempt number within the payment (1,2,3...)
        "attempt_number" INTEGER NOT NULL,

        -- Stripe references for this attempt
        "stripe_payment_intent_id" VARCHAR(255) NOT NULL,
        "stripe_charge_id" VARCHAR(255),

        "status" VARCHAR(12) NOT NULL DEFAULT 'PROCESSING',
        "failure_reason" TEXT,
        "amount_cents" INTEGER NOT NULL,
        "currency" CHAR(3) NOT NULL,

        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

        CONSTRAINT "uq_attempt_payment_number" UNIQUE ("payment_id", "attempt_number"),
        CONSTRAINT "uq_attempt_intent" UNIQUE ("stripe_payment_intent_id"),
        CONSTRAINT "chk_attempt_status" CHECK ("status" IN ('PROCESSING','SUCCEEDED','FAILED')),

        CONSTRAINT "FK_payment_attempts_payment_id"
          FOREIGN KEY ("payment_id") REFERENCES "payments" ("id") ON DELETE CASCADE
      )
    `);

    // At most ONE successful attempt per payment (single successful charge — P3)
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_one_succeeded_attempt"
        ON "payment_attempts" ("payment_id") WHERE "status" = 'SUCCEEDED'
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_payment_attempts_payment"
        ON "payment_attempts" ("payment_id")
    `);

    // stripe_accounts — one Express Connected Account per Cleaner. Capability flags
    // gate payouts (P6). Reconciliation repairs these without relying only on webhooks.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "stripe_accounts" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        -- Cleaner who owns the account (cascades on delete)
        "cleaner_id" UUID NOT NULL,

        -- Stripe account id (acct_...)
        "stripe_account_id" VARCHAR(255) NOT NULL,

        "charges_enabled" BOOLEAN NOT NULL DEFAULT FALSE,
        "payouts_enabled" BOOLEAN NOT NULL DEFAULT FALSE,
        "details_submitted" BOOLEAN NOT NULL DEFAULT FALSE,

        "country" CHAR(2),
        "default_currency" CHAR(3),
        "last_synced_at" TIMESTAMP WITH TIME ZONE,

        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

        CONSTRAINT "uq_stripe_account_cleaner" UNIQUE ("cleaner_id"),
        CONSTRAINT "uq_stripe_account_id" UNIQUE ("stripe_account_id"),

        CONSTRAINT "FK_stripe_accounts_cleaner_id"
          FOREIGN KEY ("cleaner_id") REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_stripe_accounts_cleaner"
        ON "stripe_accounts" ("cleaner_id")
    `);
    // Accounts not yet payout-eligible are the reconciliation candidates
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_stripe_accounts_not_payable"
        ON "stripe_accounts" ("last_synced_at") WHERE "payouts_enabled" = FALSE
    `);

    // payment_events — append-only sanitized ledger. Provides webhook idempotency
    // (unique stripe_event_id) and idempotency-key traceability.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payment_events" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        -- Some events (e.g. account.updated) may precede the payment link
        "payment_id" UUID,

        "source" VARCHAR(20) NOT NULL,
        "event_type" VARCHAR(80) NOT NULL,
        "stripe_event_id" VARCHAR(255),
        "idempotency_key" VARCHAR(255),
        "amount_cents" INTEGER,
        "currency" CHAR(3),
        "payload_json" JSONB NOT NULL,

        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

        CONSTRAINT "chk_payment_event_source" CHECK ("source" IN ('api','webhook')),

        CONSTRAINT "FK_payment_events_payment_id"
          FOREIGN KEY ("payment_id") REFERENCES "payments" ("id") ON DELETE CASCADE
      )
    `);

    // P8: webhook dedup by Stripe event id (partial — api events have no event id)
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_payment_event_stripe_id"
        ON "payment_events" ("stripe_event_id") WHERE "stripe_event_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_payment_events_payment"
        ON "payment_events" ("payment_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_payment_events_type"
        ON "payment_events" ("event_type")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_payment_events_idem"
        ON "payment_events" ("idempotency_key") WHERE "idempotency_key" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // payment_events
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_payment_events_idem"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_payment_events_type"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_payment_events_payment"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_payment_event_stripe_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_events"`);

    // stripe_accounts
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_stripe_accounts_not_payable"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_stripe_accounts_cleaner"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "stripe_accounts"`);

    // payment_attempts
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_payment_attempts_payment"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_one_succeeded_attempt"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_attempts"`);

    // payments
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_payments_pending_payout"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_payments_auto_release"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_payments_dispute"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_payments_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_payments_cleaner"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_payments_host"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payments"`);
  }
}
