import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Account-deletion coherence for chat (P18).
 *
 * Validates: Requirements 8.2, 8.3. The central deletion policy (`DeletionJobProcessor`)
 * anonymizes PII and marks the user DELETED — it does NOT physically remove the `users` row and
 * needs no chat-specific destructive step. Chat's coherence is a SCHEMA guarantee: participant
 * FKs (`host_id`, `cleaner_id`) and `sender_id` are `ON DELETE SET NULL` (never `CASCADE` from
 * `users`), so deleting/anonymizing a participant can never destroy a shared conversation or its
 * message history; only `thread_id`/`offer_id` cascade. These tests assert that contract at the
 * source (the migration DDL) so a future edit that reintroduces a user-cascade fails CI.
 */

const MIGRATION_PATH = join(
  __dirname,
  '..',
  '..',
  'migrations',
  '1700000019000-CreateChatTables.ts',
);

function migrationSql(): string {
  return readFileSync(MIGRATION_PATH, 'utf8');
}

/** Extract the FK constraint clause for a given constraint name. */
function fkClause(sql: string, constraint: string): string {
  const start = sql.indexOf(constraint);
  if (start === -1) {
    return '';
  }
  // Grab a window large enough to include the ON DELETE clause of this FK.
  return sql.slice(start, start + 200);
}

describe('chat account-deletion coherence (P18)', () => {
  const sql = migrationSql();

  it('conversation participant FKs reference users with ON DELETE SET NULL', () => {
    const host = fkClause(sql, 'fk_chat_conversation_host');
    const cleaner = fkClause(sql, 'fk_chat_conversation_cleaner');
    expect(host).toMatch(/REFERENCES "users"[\s\S]*ON DELETE SET NULL/);
    expect(cleaner).toMatch(/REFERENCES "users"[\s\S]*ON DELETE SET NULL/);
  });

  it('message sender FK references users with ON DELETE SET NULL', () => {
    const sender = fkClause(sql, 'fk_chat_message_sender');
    expect(sender).toMatch(/REFERENCES "users"[\s\S]*ON DELETE SET NULL/);
  });

  it('never cascades a conversation/message from a users deletion', () => {
    // No FK to "users" may use ON DELETE CASCADE.
    const usersCascade = /REFERENCES "users" \([^)]*\) ON DELETE CASCADE/;
    expect(sql).not.toMatch(usersCascade);
  });

  it('parent thread/offer FKs DO cascade (conversation removed with its parent)', () => {
    const thread = fkClause(sql, 'fk_chat_conversation_thread');
    const offer = fkClause(sql, 'fk_chat_conversation_offer');
    expect(thread).toMatch(/REFERENCES "negotiation_threads"[\s\S]*ON DELETE CASCADE/);
    expect(offer).toMatch(/REFERENCES "offers"[\s\S]*ON DELETE CASCADE/);
  });

  it('participant + sender columns are nullable (SET NULL target)', () => {
    // The columns that become NULL on deletion must not be declared NOT NULL.
    expect(sql).not.toMatch(/"host_id" UUID NOT NULL/);
    expect(sql).not.toMatch(/"cleaner_id" UUID NOT NULL/);
    expect(sql).not.toMatch(/"sender_id" UUID NOT NULL/);
  });
});
