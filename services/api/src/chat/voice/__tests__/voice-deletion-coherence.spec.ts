import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Account-deletion + orphan-discovery coherence for voice notes (P17, P18, P19).
 *
 * Validates: Requirements 7.1, 7.2, 7.3. These are SCHEMA guarantees asserted at the source (the
 * migration DDL) so a future edit that breaks them fails CI:
 * - `chat_voice_notes.message_id` is a UNIQUE FK to `chat_messages` with ON DELETE CASCADE and the
 *   table has NO `deleted_at` (audio is immutable; only the transcript fields mutate).
 * - The upload grant's `issued_to_user_id`/`consumed_message_id` are ON DELETE SET NULL and its
 *   `conversation_id` cascades — no voice note is destroyed merely because a participant is
 *   deleted, and no NEW `CASCADE`-from-`users` path is introduced.
 * - A `BEFORE DELETE` trigger tombstones the freed `object_key` into `voice_note_object_deletions`
 *   in the same transaction as the delete (so orphan bytes are discoverable after CASCADE).
 */

const MIGRATION_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  'migrations',
  '1700000023000-CreateVoiceNoteTables.ts',
);

function migrationSql(): string {
  return readFileSync(MIGRATION_PATH, 'utf8');
}

/** Extract a window after a named marker large enough to include its clause. */
function clauseAfter(sql: string, marker: string, span = 220): string {
  const start = sql.indexOf(marker);
  return start === -1 ? '' : sql.slice(start, start + span);
}

describe('voice-notes deletion & orphan coherence (P17/P18/P19)', () => {
  const sql = migrationSql();

  it('chat_voice_notes.message_id is a UNIQUE FK to chat_messages ON DELETE CASCADE', () => {
    const fk = clauseAfter(sql, 'fk_chat_voice_notes_message');
    expect(fk).toMatch(/REFERENCES "chat_messages"[\s\S]*ON DELETE CASCADE/);
    expect(sql).toMatch(/uq_chat_voice_notes_message/);
  });

  it('chat_voice_notes has NO deleted_at (audio is immutable)', () => {
    // The voice-note table definition must not declare a deleted_at column.
    const tableStart = sql.indexOf('CREATE TABLE IF NOT EXISTS "chat_voice_notes"');
    const tableEnd = sql.indexOf('CREATE TABLE', tableStart + 1);
    const tableDdl = sql.slice(tableStart, tableEnd === -1 ? undefined : tableEnd);
    expect(tableDdl).not.toMatch(/"deleted_at"/);
  });

  it('grant issued_to_user_id references users with ON DELETE SET NULL', () => {
    const fk = clauseAfter(sql, 'fk_voice_grant_user');
    expect(fk).toMatch(/REFERENCES "users"[\s\S]*ON DELETE SET NULL/);
  });

  it('grant consumed_message_id references chat_messages with ON DELETE SET NULL', () => {
    const fk = clauseAfter(sql, 'fk_voice_grant_message');
    expect(fk).toMatch(/REFERENCES "chat_messages"[\s\S]*ON DELETE SET NULL/);
  });

  it('grant conversation_id cascades (a grant is meaningless without its conversation)', () => {
    const fk = clauseAfter(sql, 'fk_voice_grant_conversation');
    expect(fk).toMatch(/REFERENCES "chat_conversations"[\s\S]*ON DELETE CASCADE/);
  });

  it('introduces NO new CASCADE-from-users path', () => {
    const usersCascade = /REFERENCES "users" \([^)]*\) ON DELETE CASCADE/;
    expect(sql).not.toMatch(usersCascade);
  });

  it('a BEFORE DELETE trigger tombstones the freed object_key in the same transaction', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION voice_note_tombstone_object/);
    expect(sql).toMatch(
      /INSERT INTO "voice_note_object_deletions" \("object_key"\) VALUES \(OLD\."object_key"\)/,
    );
    expect(sql).toMatch(/BEFORE DELETE ON "chat_voice_notes"/);
  });
});