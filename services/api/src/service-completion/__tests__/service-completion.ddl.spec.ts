import { QueryRunner } from 'typeorm';

import { CreateServiceCompletionTables1700000044000 } from '../../migrations/1700000044000-CreateServiceCompletionTables';

/**
 * DDL / migration tests (Spec 20 · P4, P8, P12, P13). The migration runs against a fake QueryRunner
 * that records every SQL statement, so the schema contract is asserted without a live database:
 * UNIQUE/CHECK constraints, FK ON DELETE behaviour, the sweep/drain partial indexes, the
 * release_trigger coherence CHECK, no `deleted_at`, and a dependency-ordered reversible `down()`.
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

describe('CreateServiceCompletionTables migration — up()', () => {
  let sql: string[];

  beforeAll(async () => {
    const { runner, sql: collected } = collect();
    await new CreateServiceCompletionTables1700000044000().up(runner);
    sql = collected;
  });

  const joined = (): string => sql.join('\n');

  it('creates all five tables', () => {
    const text = joined();
    for (const table of [
      'service_completions',
      'release_intents',
      'service_ratings',
      'completion_outbox',
      'checklist_outbox_consumers',
    ]) {
      expect(text).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
    }
  });

  it('enforces the key UNIQUE constraints', () => {
    const text = joined();
    expect(text).toContain('uq_service_completions_session" UNIQUE ("service_session_id")');
    expect(text).toContain('uq_release_intents_completion" UNIQUE ("service_completion_id")');
    expect(text).toContain(
      'uq_service_ratings_completion_role" UNIQUE ("service_completion_id", "role")',
    );
    expect(text).toContain('uq_completion_outbox_event" UNIQUE ("event_id")');
    expect(text).toContain(
      'uq_checklist_outbox_consumers_event_consumer" UNIQUE ("event_id", "consumer_name")',
    );
  });

  it('declares the state/trigger/reason/status/role/stars CHECKs incl. the trigger coherence CHECK', () => {
    const text = joined();
    expect(text).toContain(
      `CHECK ("state" IN ('AWAITING_CONFIRMATION', 'CONFIRMED', 'AUTO_RELEASED', 'DISPUTED'))`,
    );
    expect(text).toContain(
      `CHECK ("released_trigger" IS NULL OR "released_trigger" IN ('HOST_CONFIRMED', 'AUTO_RELEASE'))`,
    );
    expect(text).toContain(
      `CHECK (("released_trigger" IS NULL) = ("state" NOT IN ('CONFIRMED', 'AUTO_RELEASED')))`,
    );
    expect(text).toContain(`CHECK ("reason" IN ('HOST_CONFIRMED', 'AUTO_RELEASE'))`);
    expect(text).toContain(
      `CHECK ("status" IN ('PENDING', 'DISPATCHED', 'ACCEPTED', 'FAILED_RETRYABLE'))`,
    );
    expect(text).toContain(`CHECK ("role" IN ('HOST_RATES_CLEANER', 'CLEANER_RATES_HOST'))`);
    expect(text).toContain(`CHECK ("stars" >= 1 AND "stars" <= 5)`);
  });

  it('declares the sweep + intent-drain partial indexes (incl. DISPATCHED for the lease reclaim)', () => {
    const text = joined();
    expect(text).toContain(`WHERE "state" = 'AWAITING_CONFIRMATION'`);
    expect(text).toContain(`WHERE "status" IN ('PENDING', 'FAILED_RETRYABLE', 'DISPATCHED')`);
    expect(text).toContain('"dispatched_at"');
    expect(text).toContain('"lease_until"');
  });

  it('uses the correct FK ON DELETE behaviours (SET NULL for the durable intent + user refs)', () => {
    const text = joined();
    // session/offer cascade the completion; ratings cascade the completion.
    expect(text).toContain(
      `FOREIGN KEY ("service_session_id") REFERENCES "service_sessions" ("id") ON DELETE CASCADE`,
    );
    expect(text).toContain(
      `FOREIGN KEY ("offer_id") REFERENCES "offers" ("id") ON DELETE CASCADE`,
    );
    // release_intents.service_completion_id is SET NULL (durable financial command, retained).
    expect(text).toContain(
      `FOREIGN KEY ("service_completion_id") REFERENCES "service_completions" ("id") ON DELETE SET NULL`,
    );
    // user FKs SET NULL (Spec 13 invariant).
    expect(text).toContain(
      `FOREIGN KEY ("host_id") REFERENCES "users" ("id") ON DELETE SET NULL`,
    );
    expect(text).toContain(
      `FOREIGN KEY ("cleaner_id") REFERENCES "users" ("id") ON DELETE SET NULL`,
    );
    // service_ratings cascades with its completion.
    expect(text).toContain(
      `FOREIGN KEY ("service_completion_id") REFERENCES "service_completions" ("id") ON DELETE CASCADE`,
    );
  });

  it('has no deleted_at on any table and no FK cascade from payments (referenced by id)', () => {
    const text = joined();
    expect(text).not.toContain('"deleted_at"');
    // payment_id is a plain UUID column, not a FK to payments.
    expect(text).not.toContain('REFERENCES "payments"');
  });
});

describe('CreateServiceCompletionTables migration — down()', () => {
  it('drops tables in reverse dependency order (intents before completions)', async () => {
    const { runner, sql } = collect();
    await new CreateServiceCompletionTables1700000044000().down(runner);
    const text = sql.join('\n');
    const dropIntents = text.indexOf('DROP TABLE IF EXISTS "release_intents"');
    const dropCompletions = text.indexOf('DROP TABLE IF EXISTS "service_completions"');
    expect(dropIntents).toBeGreaterThanOrEqual(0);
    expect(dropCompletions).toBeGreaterThan(dropIntents);
  });
});
