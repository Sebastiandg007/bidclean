import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `commission_rules` table for the commission-system module.
 *
 * A versioned, scoped rate rule that sets exactly ONE side (`applies_to` HOST|CLEANER)
 * via a single `rate_bps`. NULL scope columns mean "ANY". Rates are integer basis points.
 *
 * Overlap of two ACTIVE rules with identical scope AND overlapping effective windows is
 * prevented by a GiST EXCLUDE constraint over the scope tuple + tstzrange (concurrency-safe;
 * a plain unique index cannot prevent overlap since different effective_from still overlap).
 * Requires the btree_gist extension for equality on scalar columns inside the constraint.
 *
 * Rules are NEVER physically deleted (retirement = DEACTIVATE / past effective_to), so no
 * cascade concerns here; the audit table (separate migration) references this with RESTRICT.
 */
export class CreateCommissionRules1700000015000 implements MigrationInterface {
  name = 'CreateCommissionRules1700000015000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Needed for equality operators on scalar columns within the GiST EXCLUDE constraint.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS btree_gist`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "commission_rules" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        -- Scope (NULL = ANY on that dimension)
        "country" CHAR(2),
        "subscriber_tier" VARCHAR(10),
        "service_type" VARCHAR(30),

        -- The single side this rule sets, and its rate in basis points
        "applies_to" VARCHAR(10) NOT NULL,
        "rate_bps" INTEGER NOT NULL,

        -- Selection metadata
        "priority" INTEGER NOT NULL DEFAULT 0,
        "effective_from" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "effective_to" TIMESTAMP WITH TIME ZONE,
        "is_active" BOOLEAN NOT NULL DEFAULT TRUE,

        -- Audit ownership (who created / last modified)
        "created_by" UUID,
        "updated_by" UUID,

        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

        CONSTRAINT "chk_commission_tier" CHECK
          ("subscriber_tier" IS NULL OR "subscriber_tier" IN ('FREE','PRO')),
        CONSTRAINT "chk_commission_applies_to" CHECK ("applies_to" IN ('HOST','CLEANER')),
        CONSTRAINT "chk_commission_country" CHECK
          ("country" IS NULL OR "country" IN
            ('CO','US','CA','GB','DE','FR','IT','ES','PT','NL')),
        CONSTRAINT "chk_commission_rate_bps" CHECK
          ("rate_bps" >= 0 AND "rate_bps" <= 10000),
        CONSTRAINT "chk_commission_window" CHECK
          ("effective_to" IS NULL OR "effective_to" > "effective_from"),

        CONSTRAINT "FK_commission_rules_created_by"
          FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_commission_rules_updated_by"
          FOREIGN KEY ("updated_by") REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);

    // Hot-path lookup for the cache loader (active rules by side, ordered by window).
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_commission_rules_lookup"
        ON "commission_rules" ("applies_to", "is_active", "effective_from")
        WHERE "is_active" = TRUE
    `);

    // Prevent two ACTIVE rules with identical scope AND overlapping windows, even under
    // concurrent writes. COALESCE normalizes NULL/ANY so ANY-scoped rules participate.
    // tstzrange is half-open [from, to) matching the resolver's effective_from <= now < effective_to.
    await queryRunner.query(`
      ALTER TABLE "commission_rules"
        ADD CONSTRAINT "excl_commission_rule_overlap"
        EXCLUDE USING gist (
          "applies_to" WITH =,
          COALESCE("country", '*') WITH =,
          COALESCE("subscriber_tier", '*') WITH =,
          COALESCE("service_type", '*') WITH =,
          tstzrange("effective_from", "effective_to", '[)') WITH &&
        ) WHERE ("is_active" = TRUE)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "commission_rules" DROP CONSTRAINT IF EXISTS "excl_commission_rule_overlap"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_commission_rules_lookup"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "commission_rules"`);
    // btree_gist is intentionally left installed; other features may rely on it.
  }
}
