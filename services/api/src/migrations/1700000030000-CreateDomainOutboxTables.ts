import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the five per-domain transactional outbox tables:
 * `offer_outbox`, `payment_outbox`, `negotiation_outbox`, `chat_outbox`, `voip_outbox`.
 *
 * Each bounded context owns its own outbox table and writes a row IN THE SAME transaction as the
 * business fact (after-commit-safe). The `notifications` outbox relay drains committed-but-unrelayed
 * rows into deduped intents. There is deliberately NO FK to `users`: the outbox belongs to the
 * emitting domain, and recipient resolution happens in the notifications per-domain mapper.
 *
 * `event_id` is UNIQUE per fact (the source of the ledger dedup key). Statuses/types use VARCHAR
 * (no PG enums). A partial index on `relayed_at IS NULL` bounds the relay scan.
 */
export class CreateDomainOutboxTables1700000030000 implements MigrationInterface {
  name = 'CreateDomainOutboxTables1700000030000';

  private static readonly TABLES = [
    'offer_outbox',
    'payment_outbox',
    'negotiation_outbox',
    'chat_outbox',
    'voip_outbox',
  ] as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of CreateDomainOutboxTables1700000030000.TABLES) {
      await queryRunner.query(`
        CREATE TABLE IF NOT EXISTS "${table}" (
          "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          "event_id" VARCHAR(255) NOT NULL,
          "aggregate_type" VARCHAR(30) NOT NULL,
          "aggregate_id" UUID NOT NULL,
          "type" VARCHAR(50) NOT NULL,
          "payload" JSONB NOT NULL,
          "version" INTEGER NOT NULL DEFAULT 1,
          "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          "relayed_at" TIMESTAMP WITH TIME ZONE,
          CONSTRAINT "uq_${table}_event" UNIQUE ("event_id")
        )
      `);
      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS "idx_${table}_unrelayed"
          ON "${table}" ("created_at") WHERE "relayed_at" IS NULL
      `);
      await queryRunner.query(
        `COMMENT ON TABLE "${table}" IS 'Durable transactional outbox written in the same TX as the business fact; drained by the notifications relay.'`,
      );
      await queryRunner.query(
        `COMMENT ON COLUMN "${table}"."event_id" IS 'Deterministic UNIQUE id per business fact; source of the ledger dedup key.'`,
      );
      await queryRunner.query(
        `COMMENT ON COLUMN "${table}"."relayed_at" IS 'Set by the relay after the intent is durably persisted (NULL = not yet relayed).'`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of CreateDomainOutboxTables1700000030000.TABLES) {
      await queryRunner.query(`DROP INDEX IF EXISTS "idx_${table}_unrelayed"`);
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}"`);
    }
  }
}
