import { QueryRunner } from 'typeorm';

import { CreateChecklistPhotoTables1700000043000 } from '../../migrations/1700000043000-CreateChecklistPhotoTables';

/**
 * DDL / migration tests (Spec 19 · P14, P15). The migration is run against a fake QueryRunner that
 * records every SQL statement, so the schema contract is asserted without a live database:
 * UNIQUE/CHECK constraints, FK ON DELETE behaviour, partial sweep indexes, the BEFORE DELETE
 * tombstone trigger, no `deleted_at` on metadata, and a dependency-ordered reversible `down()`.
 */

/** Collect every SQL string a migration issues. */
function collect(): { runner: QueryRunner; sql: string[] } {
  const sql: string[] = [];
  const runner = {
    query: async (statement: string): Promise<void> => {
      sql.push(statement);
    },
  } as unknown as QueryRunner;
  return { runner, sql };
}

describe('CreateChecklistPhotoTables migration — up()', () => {
  let sql: string[];

  beforeAll(async () => {
    const { runner, sql: collected } = collect();
    await new CreateChecklistPhotoTables1700000043000().up(runner);
    sql = collected;
  });

  const joined = (): string => sql.join('\n');

  it('creates all six tables', () => {
    const text = joined();
    for (const table of [
      'checklist_runs',
      'checklist_tasks',
      'checklist_task_photos',
      'checklist_upload_grants',
      'checklist_photo_object_deletions',
      'checklist_outbox',
    ]) {
      expect(text).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
    }
  });

  it('enforces UNIQUE service_session_id, (run_id, position), and object_key', () => {
    const text = joined();
    expect(text).toContain('uq_checklist_runs_service_session" UNIQUE ("service_session_id")');
    expect(text).toContain('uq_checklist_tasks_run_position" UNIQUE ("run_id", "position")');
    expect(text).toContain('uq_checklist_task_photos_object" UNIQUE ("object_key")');
    expect(text).toContain('uq_checklist_outbox_event" UNIQUE ("event_id")');
  });

  it('uses VARCHAR + CHECK (no PG enums) for state/kind/grant status', () => {
    const text = joined();
    expect(text).toContain(`"state" IN ('ACTIVE', 'COMPLETED', 'ABANDONED')`);
    expect(text).toContain(`"kind" IN ('BEFORE', 'AFTER', 'GENERAL')`);
    expect(text).toContain(`"status" IN ('ISSUED', 'CONSUMED', 'EXPIRED', 'CANCELLED')`);
    expect(text).toContain('completed_tasks" >= 0 AND "completed_tasks" <= "total_tasks"');
  });

  it('sets FK ON DELETE: CASCADE for session/offer/run/task, SET NULL for user/property', () => {
    const text = joined();
    expect(text).toContain('REFERENCES "service_sessions" ("id") ON DELETE CASCADE');
    expect(text).toContain('REFERENCES "offers" ("id") ON DELETE CASCADE');
    expect(text).toContain('REFERENCES "properties" ("id") ON DELETE SET NULL');
    expect(text).toContain('REFERENCES "users" ("id") ON DELETE SET NULL');
    expect(text).toContain('REFERENCES "checklist_runs" ("id") ON DELETE CASCADE');
    expect(text).toContain('REFERENCES "checklist_tasks" ("id") ON DELETE CASCADE');
  });

  it('creates the partial retention + active-run sweep indexes and FK indexes', () => {
    const text = joined();
    expect(text).toContain(`ON "checklist_runs" ("state", "updated_at") WHERE "state" = 'ACTIVE'`);
    expect(text).toContain(`ON "checklist_task_photos" ("uploaded_at") WHERE "object_deleted_at" IS NULL`);
    expect(text).toContain('idx_checklist_grants_status_expires');
    expect(text).toContain('idx_checklist_grants_task');
  });

  it('installs the BEFORE DELETE tombstone trigger + function (ON CONFLICT DO NOTHING)', () => {
    const text = joined();
    expect(text).toContain('CREATE OR REPLACE FUNCTION checklist_photo_tombstone_object()');
    expect(text).toContain('BEFORE DELETE ON "checklist_task_photos"');
    expect(text).toContain('ON CONFLICT ("object_key") DO NOTHING');
  });

  it('never adds a deleted_at to metadata rows', () => {
    expect(joined()).not.toContain('"deleted_at"');
  });

  it('checklist_outbox declares no shared relayed_at column (per-consumer checkpoints)', () => {
    // Assert the column is never declared (comments may mention the term); check quoted identifier.
    expect(joined()).not.toContain('"relayed_at"');
  });
});

describe('CreateChecklistPhotoTables migration — down()', () => {
  it('drops the trigger + function and every table in dependency order', async () => {
    const { runner, sql } = collect();
    await new CreateChecklistPhotoTables1700000043000().down(runner);
    const text = sql.join('\n');
    expect(text).toContain('DROP TRIGGER IF EXISTS "trg_checklist_photo_tombstone_object"');
    expect(text).toContain('DROP FUNCTION IF EXISTS checklist_photo_tombstone_object()');
    // Grants (which FK photos) drop before photos; photos before tasks; tasks before runs.
    const idx = (needle: string): number => text.indexOf(needle);
    expect(idx('DROP TABLE IF EXISTS "checklist_upload_grants"')).toBeLessThan(
      idx('DROP TABLE IF EXISTS "checklist_task_photos"'),
    );
    expect(idx('DROP TABLE IF EXISTS "checklist_task_photos"')).toBeLessThan(
      idx('DROP TABLE IF EXISTS "checklist_tasks"'),
    );
    expect(idx('DROP TABLE IF EXISTS "checklist_tasks"')).toBeLessThan(
      idx('DROP TABLE IF EXISTS "checklist_runs"'),
    );
  });
});
