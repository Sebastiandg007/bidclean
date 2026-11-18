import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Account-deletion + conversation-close coherence for voip calls (Task 9.2 · P16 / REQ-VP10).
 *
 * Validates: Requirements 4.3, 7.2, 7.3. These are SCHEMA guarantees asserted at the source (the
 * migration DDL) so a future edit that breaks them fails CI:
 * - `voip_calls.conversation_id` / `offer_id` are FK ON DELETE CASCADE (a call is meaningless
 *   without its parent conversation/offer; cascade removes calls, no media cleanup needed);
 * - `voip_calls.initiator_id` / `callee_id` are FK ON DELETE SET NULL — deleting/anonymizing a
 *   participant nulls the id but keeps the shared conversation's call history;
 * - NO new CASCADE-from-`users` path is introduced (the Spec 13 invariant);
 * - the table has NO `deleted_at` (a terminal call is an immutable audit fact);
 * - the partial unique "one active call per conversation" index exists (DB-enforced single active).
 */

const MIGRATION_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  'migrations',
  '1700000040000-CreateVoipCallsTable.ts',
);

function migrationSql(): string {
  return readFileSync(MIGRATION_PATH, 'utf8');
}

/** Extract a window after a named marker large enough to include its clause. */
function clauseAfter(sql: string, marker: string, span = 220): string {
  const start = sql.indexOf(marker);
  return start === -1 ? '' : sql.slice(start, start + span);
}

describe('voip-calls deletion & close coherence (P16)', () => {
  const sql = migrationSql();

  it('conversation_id is a FK to chat_conversations ON DELETE CASCADE', () => {
    const fk = clauseAfter(sql, 'fk_voip_calls_conversation');
    expect(fk).toMatch(/REFERENCES "chat_conversations"[\s\S]*ON DELETE CASCADE/);
  });

  it('offer_id is a FK to offers ON DELETE CASCADE', () => {
    const fk = clauseAfter(sql, 'fk_voip_calls_offer');
    expect(fk).toMatch(/REFERENCES "offers"[\s\S]*ON DELETE CASCADE/);
  });

  it('initiator_id references users with ON DELETE SET NULL (deletion coherence)', () => {
    const fk = clauseAfter(sql, 'fk_voip_calls_initiator');
    expect(fk).toMatch(/REFERENCES "users"[\s\S]*ON DELETE SET NULL/);
  });

  it('callee_id references users with ON DELETE SET NULL (deletion coherence)', () => {
    const fk = clauseAfter(sql, 'fk_voip_calls_callee');
    expect(fk).toMatch(/REFERENCES "users"[\s\S]*ON DELETE SET NULL/);
  });

  it('introduces NO new CASCADE-from-users path', () => {
    const usersCascade = /REFERENCES "users" \([^)]*\) ON DELETE CASCADE/;
    expect(sql).not.toMatch(usersCascade);
  });

  it('voip_calls has NO deleted_at (a terminal call is an immutable audit fact)', () => {
    const tableStart = sql.indexOf('CREATE TABLE IF NOT EXISTS "voip_calls"');
    const tableEnd = sql.indexOf('CREATE UNIQUE INDEX', tableStart + 1);
    const tableDdl = sql.slice(tableStart, tableEnd === -1 ? undefined : tableEnd);
    expect(tableDdl).not.toMatch(/"deleted_at"/);
  });

  it('enforces at most one active call per conversation via a partial unique index', () => {
    expect(sql).toMatch(/uq_voip_one_active_per_conversation/);
    const idx = clauseAfter(
      sql,
      'CREATE UNIQUE INDEX IF NOT EXISTS "uq_voip_one_active_per_conversation"',
      300,
    );
    expect(idx).toMatch(/"conversation_id"/);
    expect(idx).toMatch(/WHERE "status" IN \('RINGING', 'ONGOING'\)/);
  });

  it('scopes idempotency to (conversation_id, initiator_id, client_call_id) where initiator is set', () => {
    const idx = clauseAfter(
      sql,
      'CREATE UNIQUE INDEX IF NOT EXISTS "uq_voip_client_call"',
      320,
    );
    expect(idx).toMatch(/"conversation_id", "initiator_id", "client_call_id"/);
    expect(idx).toMatch(/WHERE "initiator_id" IS NOT NULL/);
  });
});
