import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the realtime-chat tables — `chat_conversations` and `chat_messages`.
 *
 * A conversation is 1:1 with a matched `negotiation_thread` (UNIQUE `thread_id`) and copies the
 * two participants (`host_id`, `cleaner_id`) and `offer_id` from it. PostgreSQL is the source of
 * truth for messages; Centrifugo is transport only.
 *
 * FK / deletion policy (deliberate, see design "Deletion-policy coherence"):
 * - `thread_id` / `offer_id` → ON DELETE CASCADE: a conversation is meaningless without its
 *   parent thread/offer, so removing the parent removes the conversation.
 * - `host_id` / `cleaner_id` (conversations) and `sender_id` (messages) → ON DELETE SET NULL,
 *   NEVER cascade from `users`: deleting/anonymizing a participant must retain the shared
 *   conversation and its history, coherent with the central account-deletion policy (which
 *   anonymizes + marks DELETED and does not physically remove the users row).
 *
 * Ordering: `chat_messages.sequence_number` is unique and strictly increasing per conversation
 * (gaps allowed); `message_seq` on the conversation is the row-locked counter that sources it.
 * `client_message_id` is unique per conversation for idempotent send. Messages are immutable in
 * v1 — there is intentionally no `deleted_at`.
 */
export class CreateChatTables1700000019000 implements MigrationInterface {
  name = 'CreateChatTables1700000019000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "chat_conversations" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        -- 1:1 with a matched negotiation thread
        "thread_id" UUID NOT NULL,
        "offer_id" UUID NOT NULL,

        -- Participants; nullable so a deleted user does not destroy the shared conversation
        "host_id" UUID,
        "cleaner_id" UUID,

        "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',

        -- Row-locked monotonic counter that sources chat_messages.sequence_number
        "message_seq" INTEGER NOT NULL DEFAULT 0,

        -- Inbox ordering; updated atomically with each message insert
        "last_message_at" TIMESTAMP WITH TIME ZONE,

        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

        CONSTRAINT "uq_chat_conversation_thread" UNIQUE ("thread_id"),
        CONSTRAINT "fk_chat_conversation_thread"
          FOREIGN KEY ("thread_id") REFERENCES "negotiation_threads" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_chat_conversation_offer"
          FOREIGN KEY ("offer_id") REFERENCES "offers" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_chat_conversation_host"
          FOREIGN KEY ("host_id") REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_chat_conversation_cleaner"
          FOREIGN KEY ("cleaner_id") REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "chk_chat_conversation_status" CHECK ("status" IN ('OPEN', 'CLOSED'))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_chat_conversations_host"
        ON "chat_conversations" ("host_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_chat_conversations_cleaner"
        ON "chat_conversations" ("cleaner_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_chat_conversations_offer"
        ON "chat_conversations" ("offer_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_chat_conversations_last_message"
        ON "chat_conversations" ("last_message_at")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "chat_messages" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        "conversation_id" UUID NOT NULL,

        -- Nullable so history survives a deleted/anonymized participant
        "sender_id" UUID,

        "type" VARCHAR(20) NOT NULL DEFAULT 'TEXT',
        "body" TEXT NOT NULL,

        -- Unique + strictly increasing per conversation (gaps allowed)
        "sequence_number" INTEGER NOT NULL,

        -- Idempotent send / optimistic reconciliation
        "client_message_id" VARCHAR(64) NOT NULL,

        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

        CONSTRAINT "fk_chat_message_conversation"
          FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_chat_message_sender"
          FOREIGN KEY ("sender_id") REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "uq_chat_message_sequence" UNIQUE ("conversation_id", "sequence_number"),
        CONSTRAINT "uq_chat_message_client_id" UNIQUE ("conversation_id", "client_message_id"),
        CONSTRAINT "chk_chat_message_type" CHECK ("type" IN ('TEXT'))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_chat_messages_conversation_seq"
        ON "chat_messages" ("conversation_id", "sequence_number" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_chat_messages_sender"
        ON "chat_messages" ("sender_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_chat_messages_sender"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_chat_messages_conversation_seq"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "chat_messages"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_chat_conversations_last_message"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_chat_conversations_offer"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_chat_conversations_cleaner"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_chat_conversations_host"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "chat_conversations"`);
  }
}
