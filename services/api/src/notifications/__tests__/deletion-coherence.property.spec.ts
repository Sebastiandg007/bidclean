import * as fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Property-based test (fast-check, >=100 iters) for deletion coherence.
 *
 * Feature: push-notifications, Property 18: Deletion coherence (user-owned)
 * Validates: Requirements 7.2
 *
 * Notification data is USER-OWNED (the deliberate contrast with chat/voip SET NULL). Every FK from a
 * user-owned notification table to `users` MUST be `ON DELETE CASCADE`, so deleting a user removes
 * their devices, preferences, and ledger rows. This asserts the schema invariant across the three
 * migrations for arbitrary table selections (a real DB cascade run is an integration test, blocked
 * without Postgres — see the module README).
 */

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

/** The user-owned notification tables and the migration that creates each. */
const USER_OWNED = [
  { table: 'notification_devices', file: '1700000031000-CreateNotificationDevices.ts' },
  { table: 'notification_preferences', file: '1700000032000-CreateNotificationPreferences.ts' },
  { table: 'notifications', file: '1700000033000-CreateNotificationsLedger.ts' },
] as const;

function migrationSql(file: string): string {
  return readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
}

describe('Deletion coherence — Property 18', () => {
  it('Property 18: every user-owned table FKs to users with ON DELETE CASCADE', () => {
    // Feature: push-notifications, Property 18: Deletion coherence (user-owned)
    fc.assert(
      fc.property(fc.constantFrom(...USER_OWNED), ({ file }) => {
        const sql = migrationSql(file);
        // The FK references users and is declared ON DELETE CASCADE.
        expect(sql).toMatch(/REFERENCES\s+"users"\s+\("id"\)\s+ON DELETE CASCADE/i);
        // It must NOT use SET NULL (that is the chat/voip shared-history policy, not notifications).
        expect(sql).not.toMatch(/REFERENCES\s+"users"\s+\("id"\)\s+ON DELETE SET NULL/i);
      }),
      { numRuns: 100 },
    );
  });

  it('all three user-owned tables are covered', () => {
    for (const { file } of USER_OWNED) {
      expect(migrationSql(file)).toMatch(/ON DELETE CASCADE/i);
    }
  });
});
