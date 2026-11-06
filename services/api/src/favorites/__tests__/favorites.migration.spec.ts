import { QueryRunner } from 'typeorm';

import { CreateFavorites1700000046000 } from '../../migrations/1700000046000-CreateFavorites';

/**
 * DDL / migration tests for favorites (Spec 22).
 *
 * A recording QueryRunner captures the SQL emitted by up()/down() so we can assert the constraints,
 * indexes, CASCADE FKs, absence of updated_at/deleted_at, table/column comments, IF NOT EXISTS, and
 * reversibility — without a real database.
 */

function recordingRunner(): { runner: QueryRunner; sql: () => string } {
  const queries: string[] = [];
  const runner = {
    query: async (q: string): Promise<void> => {
      queries.push(q);
    },
  } as unknown as QueryRunner;
  return { runner, sql: () => queries.join('\n') };
}

describe('CreateFavorites migration', () => {
  it('up() creates the favorites table with the required constraints, CASCADE FKs, and indexes', async () => {
    const { runner, sql } = recordingRunner();
    await new CreateFavorites1700000046000().up(runner);
    const ddl = sql();

    expect(ddl).toMatch(/CREATE TABLE IF NOT EXISTS "favorites"/);
    expect(ddl).toMatch(/"id" UUID PRIMARY KEY DEFAULT gen_random_uuid\(\)/);
    expect(ddl).toMatch(/"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW\(\)/);

    // Uniqueness + self-check.
    expect(ddl).toMatch(/CONSTRAINT "uq_favorites_host_cleaner" UNIQUE \("host_id", "cleaner_id"\)/);
    expect(ddl).toMatch(/CONSTRAINT "chk_favorites_not_self" CHECK \("host_id" <> "cleaner_id"\)/);

    // Both FKs CASCADE.
    expect(ddl).toMatch(/"host_id"\) REFERENCES "users" \("id"\) ON DELETE CASCADE/);
    expect(ddl).toMatch(/"cleaner_id"\) REFERENCES "users" \("id"\) ON DELETE CASCADE/);

    // Indexes (host, cleaner, keyset).
    expect(ddl).toMatch(/CREATE INDEX IF NOT EXISTS "idx_favorites_host" ON "favorites" \("host_id"\)/);
    expect(ddl).toMatch(/CREATE INDEX IF NOT EXISTS "idx_favorites_cleaner" ON "favorites" \("cleaner_id"\)/);
    expect(ddl).toMatch(/"idx_favorites_host_created"[\s\S]*"host_id", "created_at" DESC, "id" DESC/);

    // Comments present.
    expect(ddl).toMatch(/COMMENT ON TABLE "favorites"/);
    expect(ddl).toMatch(/COMMENT ON COLUMN "favorites"\."host_id"/);
  });

  it('up() has NO updated_at / deleted_at columns (add-or-remove, not audited)', async () => {
    const { runner, sql } = recordingRunner();
    await new CreateFavorites1700000046000().up(runner);
    const ddl = sql();
    expect(ddl).not.toMatch(/updated_at/);
    expect(ddl).not.toMatch(/deleted_at/);
  });

  it('down() drops the indexes then the table (reversible)', async () => {
    const { runner, sql } = recordingRunner();
    await new CreateFavorites1700000046000().down(runner);
    const ddl = sql();
    expect(ddl).toMatch(/DROP INDEX IF EXISTS "idx_favorites_host_created"/);
    expect(ddl).toMatch(/DROP INDEX IF EXISTS "idx_favorites_cleaner"/);
    expect(ddl).toMatch(/DROP INDEX IF EXISTS "idx_favorites_host"/);
    expect(ddl).toMatch(/DROP TABLE IF EXISTS "favorites"/);
  });
});
