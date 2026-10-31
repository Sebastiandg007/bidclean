import { QueryRunner } from 'typeorm';

import { CreateDisputeSystemTables1700000045000 } from '../../migrations/1700000045000-CreateDisputeSystemTables';

/**
 * DDL / migration tests (Spec 21 · P1, P8, P13). The migration runs against a fake QueryRunner that
 * records every SQL statement, so the schema contract is asserted without a live database: the
 * partial-unique active dispute, per-dispute intent uniques, FK ON DELETE behaviour (users SET NULL,
 * completion/offer CASCADE, BOTH intent tables' dispute_id SET NULL with payment_id NOT NULL), the
 * SLA/drain/needs-review/retention partial indexes, the terminal-resolution + PARTIAL-amount CHECKs,
 * the tombstone trigger, no `deleted_at`, the additive payments column, and a reversible `down()`.
 */
function collect(): { runner: QueryRunner; sql: string[] } {
  const sql: string[] = [];
  const runner = {
    query: async (statement: string): Promise<void> => {
      sql.push(statement);
    },
  } as unknown as QueryRunner;
  return { runner, sql };
}

describe('CreateDisputeSystemTables migration — up()', () => {
  let sql: string[];

  beforeAll(async () => {
    const { runner, sql: collected } = collect();
    await new CreateDisputeSystemTables1700000045000().up(runner);
    sql = collected;
  });

  const joined = (): string => sql.join('\n');

  it('creates all dispute tables + the completion_outbox_consumers checkpoint', () => {
    const text = joined();
    for (const table of [
      'disputes',
      'dispute_evidence',
      'dispute_upload_grants',
      'dispute_escrow_intents',
      'dispute_financial_intents',
      'dispute_object_deletions',
      'dispute_outbox',
      'completion_outbox_consumers',
    ]) {
      expect(text).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
    }
  });

  it('enforces the partial-unique active dispute + per-dispute intent uniques', () => {
    const text = joined();
    expect(text).toContain(
      `"uq_disputes_active_completion"\n        ON "disputes" ("service_completion_id") WHERE "state" IN ('OPEN', 'UNDER_REVIEW')`,
    );
    expect(text).toContain(
      `"uq_dispute_financial_intent_dispute"\n        ON "dispute_financial_intents" ("dispute_id") WHERE "dispute_id" IS NOT NULL`,
    );
    expect(text).toContain(
      `"uq_dispute_escrow_intent_target"\n        ON "dispute_escrow_intents" ("dispute_id", "target") WHERE "dispute_id" IS NOT NULL`,
    );
    expect(text).toContain('uq_dispute_evidence_object');
    expect(text).toContain('uq_dispute_outbox_event" UNIQUE ("event_id")');
  });

  it('declares the sweep / drain / needs-review / retention partial indexes', () => {
    const text = joined();
    expect(text).toContain(`"idx_disputes_sla"\n        ON "disputes" ("resolution_deadline") WHERE "state" IN ('OPEN', 'UNDER_REVIEW')`);
    expect(text).toContain(`WHERE "status" IN ('PENDING', 'FAILED_RETRYABLE', 'DISPATCHED')`);
    expect(text).toContain(`"idx_dispute_financial_intents_blocked"\n        ON "dispute_financial_intents" ("created_at") WHERE "status" = 'ACTION_BLOCKED'`);
    expect(text).toContain(`WHERE "object_key" IS NOT NULL AND "object_deleted_at" IS NULL`);
  });

  it('sets FK ON DELETE behaviour: users SET NULL, completion/offer CASCADE, intents SET NULL', () => {
    const text = joined();
    expect(text).toContain('"fk_disputes_completion"\n          FOREIGN KEY ("service_completion_id") REFERENCES "service_completions" ("id") ON DELETE CASCADE');
    expect(text).toContain('"fk_disputes_offer"\n          FOREIGN KEY ("offer_id") REFERENCES "offers" ("id") ON DELETE CASCADE');
    expect(text).toContain('"fk_disputes_host"\n          FOREIGN KEY ("host_id") REFERENCES "users" ("id") ON DELETE SET NULL');
    expect(text).toContain('"fk_disputes_cleaner"\n          FOREIGN KEY ("cleaner_id") REFERENCES "users" ("id") ON DELETE SET NULL');
    expect(text).toContain('"fk_disputes_initiator"\n          FOREIGN KEY ("initiator_id") REFERENCES "users" ("id") ON DELETE SET NULL');
    expect(text).toContain('"fk_dispute_evidence_dispute"\n          FOREIGN KEY ("dispute_id") REFERENCES "disputes" ("id") ON DELETE CASCADE');
    expect(text).toContain('"fk_dispute_escrow_intents_dispute"\n          FOREIGN KEY ("dispute_id") REFERENCES "disputes" ("id") ON DELETE SET NULL');
    expect(text).toContain('"fk_dispute_financial_intents_dispute"\n          FOREIGN KEY ("dispute_id") REFERENCES "disputes" ("id") ON DELETE SET NULL');
  });

  it('keeps payment_id NOT NULL on both intent tables (survives cascade) and no FK from payments', () => {
    const text = joined();
    // Both intent tables carry a NOT NULL payment_id that is never nulled.
    const escrowTable = text.slice(text.indexOf('CREATE TABLE IF NOT EXISTS "dispute_escrow_intents"'));
    expect(escrowTable).toContain('"payment_id" UUID NOT NULL');
    const finTable = text.slice(text.indexOf('CREATE TABLE IF NOT EXISTS "dispute_financial_intents"'));
    expect(finTable).toContain('"payment_id" UUID NOT NULL');
    // No FK references payments (its own bounded context).
    expect(text).not.toContain('REFERENCES "payments"');
  });

  it('enforces the terminal-resolution + PARTIAL-amount + status CHECKs (incl. ACTION_BLOCKED)', () => {
    const text = joined();
    expect(text).toContain(`CONSTRAINT "chk_disputes_terminal_resolution"\n          CHECK ("state" NOT IN ('RESOLVED', 'EXPIRED') OR "resolution" IS NOT NULL)`);
    expect(text).toContain(`CONSTRAINT "chk_disputes_partial_amount"\n          CHECK ("resolution" <> 'PARTIAL' OR "resolution_refund_cents" IS NOT NULL)`);
    expect(text).toContain(`'ACTION_BLOCKED'`);
    expect(text).toContain(`CHECK ("action" <> 'PARTIAL_REFUND' OR "amount_cents" IS NOT NULL)`);
  });

  it('creates the BEFORE DELETE tombstone trigger + function', () => {
    const text = joined();
    expect(text).toContain('CREATE OR REPLACE FUNCTION dispute_evidence_tombstone_object()');
    expect(text).toContain('BEFORE DELETE ON "dispute_evidence"');
    expect(text).toContain(`INSERT INTO "dispute_object_deletions" ("object_key", "reason")`);
    expect(text).toContain(`ON CONFLICT ("object_key") DO NOTHING`);
  });

  it('adds the additive payments.dispute_settled_at column (P15 authority)', () => {
    const text = joined();
    expect(text).toContain(`ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "dispute_settled_at"`);
  });

  it('never adds a deleted_at column on any dispute table', () => {
    expect(joined()).not.toContain('"deleted_at"');
  });
});

describe('CreateDisputeSystemTables migration — down()', () => {
  it('is reversible: drops the trigger/function, all tables, and the additive column', async () => {
    const { runner, sql } = collect();
    await new CreateDisputeSystemTables1700000045000().down(runner);
    const text = sql.join('\n');
    expect(text).toContain('DROP TRIGGER IF EXISTS "trg_dispute_evidence_tombstone_object"');
    expect(text).toContain('DROP FUNCTION IF EXISTS dispute_evidence_tombstone_object()');
    expect(text).toContain('DROP TABLE IF EXISTS "disputes"');
    expect(text).toContain('DROP TABLE IF EXISTS "dispute_financial_intents"');
    expect(text).toContain('DROP TABLE IF EXISTS "completion_outbox_consumers"');
    expect(text).toContain('ALTER TABLE "payments" DROP COLUMN IF EXISTS "dispute_settled_at"');
  });
});
