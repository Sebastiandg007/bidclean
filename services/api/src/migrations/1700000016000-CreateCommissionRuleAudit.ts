import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the append-only `commission_rule_audit` table.
 *
 * Every commission-rule mutation (CREATE|UPDATE|ACTIVATE|DEACTIVATE) appends one immutable
 * row capturing actor, timestamp, and before/after values. The FK to commission_rules uses
 * ON DELETE RESTRICT so audit history can never be cascaded away (and rules are never
 * physically deleted anyway). Rate values are stored as integer basis points inside JSONB.
 */
export class CreateCommissionRuleAudit1700000016000 implements MigrationInterface {
  name = 'CreateCommissionRuleAudit1700000016000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "commission_rule_audit" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        -- RESTRICT: history must survive; rules are never physically deleted
        "rule_id" UUID NOT NULL,

        "action" VARCHAR(12) NOT NULL,
        "actor_id" UUID,

        -- Sanitized scope + rate (integer bps) + window + flags snapshots
        "old_values" JSONB,
        "new_values" JSONB NOT NULL,

        "reason" TEXT,

        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

        CONSTRAINT "chk_commission_audit_action" CHECK
          ("action" IN ('CREATE','UPDATE','ACTIVATE','DEACTIVATE')),

        CONSTRAINT "FK_commission_rule_audit_rule"
          FOREIGN KEY ("rule_id") REFERENCES "commission_rules" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_commission_rule_audit_actor"
          FOREIGN KEY ("actor_id") REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_commission_rule_audit_rule"
        ON "commission_rule_audit" ("rule_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_commission_rule_audit_actor"
        ON "commission_rule_audit" ("actor_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_commission_rule_audit_actor"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_commission_rule_audit_rule"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "commission_rule_audit"`);
  }
}
