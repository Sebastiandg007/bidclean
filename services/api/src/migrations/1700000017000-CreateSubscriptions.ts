import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `subscriptions` mirror table — one durable row per user.
 *
 * A read-optimized projection of RevenueCat entitlement state (`cleaner_pro`, `host_pro`,
 * `ad_free`). Each entitlement carries its own `_active` / `_expires_at` / `_store` snapshot
 * and a per-entitlement `_last_event_at` used as the out-of-order guard (a stale event never
 * overwrites a newer per-entitlement state). Runtime authorization must evaluate
 * `_active AND (_expires_at IS NULL OR _expires_at > now)`; `active` alone is not authoritative.
 *
 * The FK to `users` uses ON DELETE CASCADE so the mirror row disappears with the account
 * (the append-only ledger, by contrast, has NO FK and is anonymized instead).
 */
export class CreateSubscriptions1700000017000 implements MigrationInterface {
  name = 'CreateSubscriptions1700000017000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "subscriptions" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        -- = RevenueCat app_user_id (internal user UUID)
        "user_id" UUID NOT NULL,

        "cleaner_pro_active" BOOLEAN NOT NULL DEFAULT FALSE,
        "cleaner_pro_expires_at" TIMESTAMP WITH TIME ZONE,
        "cleaner_pro_store" VARCHAR(20),
        "cleaner_pro_last_event_at" TIMESTAMP WITH TIME ZONE,

        "host_pro_active" BOOLEAN NOT NULL DEFAULT FALSE,
        "host_pro_expires_at" TIMESTAMP WITH TIME ZONE,
        "host_pro_store" VARCHAR(20),
        "host_pro_last_event_at" TIMESTAMP WITH TIME ZONE,

        "ad_free_active" BOOLEAN NOT NULL DEFAULT FALSE,
        "ad_free_expires_at" TIMESTAMP WITH TIME ZONE,
        "ad_free_store" VARCHAR(20),
        "ad_free_last_event_at" TIMESTAMP WITH TIME ZONE,

        -- Last full reconcile against RevenueCat (distinct from per-entitlement event times)
        "last_reconciled_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

        CONSTRAINT "uq_subscriptions_user" UNIQUE ("user_id"),
        CONSTRAINT "fk_subscriptions_user"
          FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_sub_cleaner_store" CHECK ("cleaner_pro_store" IS NULL OR "cleaner_pro_store" IN
          ('app_store','play_store','amazon','stripe','promotional')),
        CONSTRAINT "chk_sub_host_store" CHECK ("host_pro_store" IS NULL OR "host_pro_store" IN
          ('app_store','play_store','amazon','stripe','promotional')),
        CONSTRAINT "chk_sub_adfree_store" CHECK ("ad_free_store" IS NULL OR "ad_free_store" IN
          ('app_store','play_store','amazon','stripe','promotional'))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_subscriptions_user"
        ON "subscriptions" ("user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_subscriptions_reconcile"
        ON "subscriptions" ("last_reconciled_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_subscriptions_expiry"
        ON "subscriptions" ("cleaner_pro_expires_at", "host_pro_expires_at")
        WHERE "cleaner_pro_active" = TRUE OR "host_pro_active" = TRUE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_subscriptions_expiry"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_subscriptions_reconcile"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_subscriptions_user"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "subscriptions"`);
  }
}
